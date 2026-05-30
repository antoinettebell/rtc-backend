const {
  OrderService: Service,
  FoodTruckService,
  UserService,
  MenuItemService,
  CouponService,
  CouponUsageService,
  OrderCounterService,
  SettingService,
  PaymentsLogService,
  PlanService,
  EmployeeSessionService,
} = require('../services');
const entityName = 'Order';
const mongoose = require('mongoose');
const https = require('https');
const http = require('http');
const CustomNotification = require('../../helper/custom-notification');
const PaymentHelper = require('../../helper/payment-helper');
const MailHelper = require('../../helper/mail-helper');
const TaxHelper = require('../../helper/tax-helper');
const {
  assertWalkUpPosPaymentMethodAllowed,
  assertVendorPlanCapability,
  normalizeVendorPlan,
} = require('../../helper/vendor-plan-helper');
const { OrderModel } = require('../../models');

const { env } = require('../../config');

const toMoney = (value, fallback = 0) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : fallback;
};

const BUILT_IN_DELIVERY_FEE = 6.49;
const PLATFORM_SERVICE_FEE_RATE = 3.5;

const normalizeDeliveryFee = (fulfillmentType, deliveryFee) => {
  if (fulfillmentType !== 'DELIVERY') {
    return 0;
  }

  if (deliveryFee !== undefined && deliveryFee !== null && deliveryFee !== '') {
    return toMoney(deliveryFee);
  }

  return BUILT_IN_DELIVERY_FEE;
};

const normalizeDriverTip = (fulfillmentType, tip, tips) =>
  fulfillmentType === 'DELIVERY' ? toMoney(tip ?? tips) : 0;

const calculatePlatformServiceFee = (baseAmount, applyFee) =>
  applyFee
    ? toMoney((PLATFORM_SERVICE_FEE_RATE * toMoney(baseAmount)) / 100)
    : 0;

const buildAvalaraAddress = async (addressData) => {
  const parsed = await TaxHelper.parseDynamicAddress(addressData);

  return {
    line1: parsed.lines || null,
    city: parsed.city,
    region: parsed.region,
    postalCode: parsed.postalCode,
    country: parsed.country,
    latitude: parsed.latitude || null,
    longitude: parsed.longitude || null,
  };
};

const getOrderAvalaraAddresses = async ({
  foodTruck,
  locationId,
  fulfillmentType,
  deliveryAddress,
  deliveryLat,
  deliveryLong,
}) => {
  const loc = (foodTruck.locations || []).find(
    (itm) => itm.zipcode && itm._id.toString() === locationId
  );

  if (!loc) {
    return { loc: null, shipFrom: null, shipTo: null };
  }

  const shipFrom = await buildAvalaraAddress(loc);
  const shipTo =
    fulfillmentType === 'DELIVERY' && deliveryAddress
      ? await buildAvalaraAddress({
          address: deliveryAddress,
          lat: deliveryLat,
          long: deliveryLong,
        })
      : shipFrom;

  return { loc, shipFrom, shipTo };
};

const calculateAvalaraOrderTax = async ({
  foodTruck,
  locationId,
  fulfillmentType,
  deliveryAddress,
  deliveryLat,
  deliveryLong,
  foodAmount,
  deliveryFee,
  serviceFee = 0,
  type = 'SalesOrder',
  commit = false,
  code,
  customerCode,
  purchaseOrderNo,
}) => {
  const { loc, shipFrom, shipTo } = await getOrderAvalaraAddresses({
    foodTruck,
    locationId,
    fulfillmentType,
    deliveryAddress,
    deliveryLat,
    deliveryLong,
  });

  if (!loc) {
    return { loc: null, result: null };
  }

  const result = await TaxHelper.calculateMarketplaceFoodDeliveryTax({
    shipFrom,
    shipTo,
    foodAmount,
    deliveryFee: fulfillmentType === 'DELIVERY' ? deliveryFee : 0,
    serviceFee,
    type,
    commit,
    code,
    customerCode,
    purchaseOrderNo,
  });

  return { loc, result };
};

const WALK_UP_ORDER_SOURCES = ['VENDOR_POS', 'WALK_UP_EMPLOYEE'];

const isVendorPosOrder = (user, orderSource) =>
  ['VENDOR', 'EMPLOYEE'].includes(user?.userType) &&
  WALK_UP_ORDER_SOURCES.includes(orderSource);

const normalizeWalkUpOrderSource = (user, orderSource) => {
  if (user?.userType === 'EMPLOYEE' && orderSource === 'VENDOR_POS') {
    return 'WALK_UP_EMPLOYEE';
  }

  return orderSource;
};

const isCashPaymentMethod = (paymentMethod) =>
  ['COD', 'CASH'].includes(paymentMethod);

const isGatewayPaymentMethod = (paymentMethod) =>
  !isCashPaymentMethod(paymentMethod);

const getFoodTruckPlan = async (foodTruck) =>
  foodTruck?.planId ? PlanService.getById(foodTruck.planId) : null;

const assertVendorPosAccess = async (foodTruck, paymentMethod) => {
  const plan = await getFoodTruckPlan(foodTruck);
  assertWalkUpPosPaymentMethodAllowed(plan, paymentMethod);

  if (paymentMethod === 'TAP_TO_PAY') {
    assertVendorPlanCapability(
      plan,
      'tapToPay',
      'Tap to Pay is not available for your current vendor plan.'
    );
  }

  return normalizeVendorPlan(plan);
};

const buildWalkUpAuditFields = ({
  user,
  foodTruck,
  locationId,
  orderSource,
  paymentMethod,
  plan,
}) => {
  if (!WALK_UP_ORDER_SOURCES.includes(orderSource)) {
    return {};
  }

  const vendorUserId =
    user.userType === 'EMPLOYEE' ? user.vendor_user_id : user._id;
  const foodTruckId = foodTruck?._id;
  const employeeName =
    user.userType === 'EMPLOYEE'
      ? [user.first_name, user.last_name].filter(Boolean).join(' ')
      : null;

  return {
    created_by_type: user.userType === 'EMPLOYEE' ? 'EMPLOYEE' : 'VENDOR',
    employee_internal_id:
      user.userType === 'EMPLOYEE' ? user.employee_internal_id : null,
    employee_session_id:
      user.userType === 'EMPLOYEE' ? user.employee_session_id : null,
    employee_login_id:
      user.userType === 'EMPLOYEE' ? user.employee_login_id : null,
    employee_name: employeeName || null,
    vendor_user_id: vendorUserId,
    food_truck_id: foodTruckId,
    location_id: locationId,
    order_source: orderSource,
    payment_method: paymentMethod,
    vendor_tier_at_transaction: plan
      ? {
          slug: plan.slug,
          name: plan.name,
          rate: plan.rate,
          payoutTimingLabel: plan.payoutTimingLabel,
          capabilities: plan.capabilities,
        }
      : null,
    created_at: new Date(),
  };
};

const touchEmployeeSession = async (user) => {
  if (user?.userType !== 'EMPLOYEE') {
    return;
  }

  await EmployeeSessionService.touchSession(
    user.employee_session_id,
    user.employee_internal_id
  );
};

const assertActiveEmployeeSession = async (user) => {
  if (user?.userType !== 'EMPLOYEE') {
    return null;
  }

  return EmployeeSessionService.assertActiveEmployeeSession(
    user.employee_session_id,
    user.employee_internal_id
  );
};

const assertPosActorFoodTruckAccess = (user, foodTruck, locationId = null) => {
  if (user?.userType === 'VENDOR') {
    return foodTruck.userId?.toString() === user._id?.toString();
  }

  if (user?.userType === 'EMPLOYEE') {
    const hasTruckAccess =
      foodTruck._id?.toString() === user.food_truck_id?.toString() &&
      foodTruck.userId?.toString() === user.vendor_user_id?.toString();
    const hasLocationAccess =
      !locationId ||
      locationId?.toString() === user.assigned_location_id?.toString();

    return hasTruckAccess && hasLocationAccess;
  }

  return false;
};

const assertVendorTapToPayAccess = async (user) => {
  if (!['VENDOR', 'EMPLOYEE'].includes(user?.userType)) {
    return;
  }

  const foodTruck =
    user.userType === 'EMPLOYEE'
      ? await FoodTruckService.getByData(
          { _id: user.food_truck_id, userId: user.vendor_user_id },
          { singleResult: true }
        )
      : await FoodTruckService.getByData(
          { userId: user._id },
          { singleResult: true }
        );
  const plan = await getFoodTruckPlan(foodTruck);
  assertVendorPlanCapability(
    plan,
    'tapToPay',
    'Tap to Pay is not available for your current vendor plan.'
  );
};

const normalizeOpaquePaymentData = (paymentData) => {
  if (!paymentData || typeof paymentData !== 'object') {
    return {
      opaqueToken: paymentData,
      dataDescriptor: null,
    };
  }

  const tokenSource =
    paymentData.opaqueToken && typeof paymentData.opaqueToken === 'object'
      ? paymentData.opaqueToken
      : paymentData.opaqueData && typeof paymentData.opaqueData === 'object'
      ? paymentData.opaqueData
      : paymentData;

  return {
    opaqueToken:
      tokenSource.dataValue ||
      tokenSource.token ||
      tokenSource.opaqueToken ||
      paymentData.dataValue ||
      paymentData.token ||
      null,
    dataDescriptor:
      tokenSource.dataDescriptor || paymentData.dataDescriptor || null,
  };
};

const isLocationOpenForNormalOrdering = (foodTruck, locationId) => {
  if (!locationId) return false;

  const loc = (foodTruck.locations || []).find(
    (item) => item._id?.toString() === locationId
  );
  if (!loc) return false;

  return foodTruck.currentLocation?.toString() === locationId;
};

const buildInitialStatusTime = (orderStatus) => {
  const now = new Date().toISOString();
  return {
    placedAt: now,
    canceledAt: null,
    acceptedAt:
      orderStatus === 'ACCEPTED' || orderStatus === 'PREPARING' ? now : null,
    rejectedAt: null,
    preparingAt: orderStatus === 'PREPARING' ? now : null,
    readyAt: null,
    driverPickedUpAt: null,
    deliveredAt: null,
    completedAt: null,
  };
};

const queueGuestSmsNotificationStub = async ({ order, guestCustomer }) => {
  if (!guestCustomer?.phone) {
    return;
  }

  console.log('Guest SMS notification stub queued', {
    orderId: order?._id,
    orderNumber: order?.orderNumber,
    phone: guestCustomer.phone,
  });
};

const shouldCreateShipdayDelivery = (order) =>
  order?.fulfillmentType === 'DELIVERY' || order?.orderType === 'DELIVERY';

const getCustomerAddress = (user) => {
  const parts = [
    user?.addressLine1,
    user?.addressLine2,
    user?.addressCity,
    user?.addressState,
    user?.addressPostal,
    user?.addressCountry,
  ].filter((part) => part && part !== 'NA');

  return parts.join(', ');
};

const postJson = async (url, payload) => {
  const body = JSON.stringify(payload);
  const parsedUrl = new URL(url);

  return new Promise((resolve, reject) => {
    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const req = transport.request(
      {
        hostname: parsedUrl.hostname,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          const responseBody = (() => {
            try {
              return JSON.parse(responseData);
            } catch (e) {
              return responseData;
            }
          })();

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseBody);
            return;
          }

          const error = new Error('Shipday delivery creation failed');
          error.statusCode = res.statusCode;
          error.responseBody = responseBody;
          reject(error);
        });
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
};

const createShipdayDeliveryForAcceptedOrder = async (order, foodTruck) => {
  if (!shouldCreateShipdayDelivery(order) || order.shipdayOrderCreatedAt) {
    return null;
  }

  const shipdayDeliveryFunctionUrl =
    process.env.SHIPDAY_DELIVERY_FUNCTION_URL ||
    process.env.AZURE_SHIPDAY_FUNCTION_URL;

  if (!shipdayDeliveryFunctionUrl) {
    throw new Error(
      'Missing SHIPDAY_DELIVERY_FUNCTION_URL or AZURE_SHIPDAY_FUNCTION_URL'
    );
  }

  const customer = await UserService.getById(order.userId);
  const vendorLocation = order.locationData || {};
  const customerAddress = order.deliveryAddress || getCustomerAddress(customer);
  const vendorAddress = vendorLocation.address || foodTruck?.address || '';

  if (!customerAddress) {
    throw new Error('Customer delivery address is required for Shipday');
  }

  if (!vendorAddress) {
    throw new Error('Vendor pickup address is required for Shipday');
  }

  return postJson(shipdayDeliveryFunctionUrl, {
    fulfillmentType: 'DELIVERY',
    orderId: order.orderNumber || order._id.toString(),
    customerName: [customer?.firstName, customer?.lastName]
      .filter(Boolean)
      .join(' '),
    customerPhone: `${customer?.countryCode || ''}${
      customer?.mobileNumber || ''
    }`,
    customerAddress,
    vendorName: foodTruck?.name,
    vendorAddress,
    totalOrderCost: order.totalOrderCost || order.total,
    total: order.total,
    deliveryFee: normalizeDeliveryFee(order.fulfillmentType, order.deliveryFee),
    tips: order.tips || order.tip || 0,
    tip: order.tip || order.tips || 0,
    tax: order.tax || order.taxAmount || 0,
  });
};

const claimShipdayDeliveryCreation = async (order) => {
  if (!shouldCreateShipdayDelivery(order) || order.shipdayOrderCreatedAt) {
    return false;
  }

  const result = await OrderModel.updateOne(
    {
      _id: order._id,
      shipdayOrderCreatedAt: null,
      shipdayCreationStatus: { $ne: 'PENDING' },
    },
    {
      $set: {
        shipdayCreationStartedAt: new Date(),
        shipdayCreationStatus: 'PENDING',
      },
    }
  );

  return result.modifiedCount === 1;
};

const getShipdayDeliveryOrderId = (order) => {
  const response = order?.shipdayResponse || {};
  return (
    response.orderId ||
    response.order_id ||
    response.id ||
    response.orderNumber ||
    response.order_number ||
    response.order?.orderId ||
    response.order?.orderNumber ||
    response.data?.orderId ||
    response.data?.orderNumber ||
    null
  );
};

const updateShipdayReadyForPickup = async (order) => {
  if (!shouldCreateShipdayDelivery(order)) {
    return null;
  }

  const shipdayOrderId = getShipdayDeliveryOrderId(order);
  if (!shipdayOrderId) {
    throw new Error('Missing Shipday order id for ready for pickup update');
  }

  const shipdayStatusFunctionUrl =
    process.env.SHIPDAY_DELIVERY_STATUS_FUNCTION_URL ||
    process.env.AZURE_SHIPDAY_STATUS_FUNCTION_URL;

  if (!shipdayStatusFunctionUrl) {
    throw new Error(
      'Missing SHIPDAY_DELIVERY_STATUS_FUNCTION_URL or AZURE_SHIPDAY_STATUS_FUNCTION_URL'
    );
  }

  return postJson(shipdayStatusFunctionUrl, {
    action: 'READY_FOR_PICKUP',
    orderId: order.orderNumber || order._id.toString(),
    shipdayOrderId,
    readyToPickup: true,
  });
};

const normalizeShipdayStatus = (status) =>
  String(status || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

const SHIPDAY_STATUS_MAP = {
  ACCEPTED: 'ACCEPTED',
  PICKED_UP: 'DRIVER_PICKED_UP',
  READY_TO_DELIVER: 'DRIVER_PICKED_UP',
  DELIVERED: 'DELIVERED',
  ALREADY_DELIVERED: 'DELIVERED',
};

const getShipdayOrderFilter = (orderId) => {
  const filters = [{ orderNumber: Number(orderId) }];

  if (mongoose.Types.ObjectId.isValid(orderId)) {
    filters.push({ _id: new mongoose.Types.ObjectId(orderId) });
  }

  return {
    deletedAt: null,
    $or: filters.filter((filter) => {
      if ('orderNumber' in filter) {
        return Number.isFinite(filter.orderNumber);
      }
      return true;
    }),
  };
};

const normalizeMenuOptions = (menuItem, type) => {
  const optionsKey = `${type}Options`;
  const legacyKey = type === 'flavor' ? 'flavors' : 'toppings';
  const rawOptions =
    Array.isArray(menuItem?.[optionsKey]) && menuItem[optionsKey].length > 0
      ? menuItem[optionsKey]
      : menuItem?.[legacyKey];

  if (!Array.isArray(rawOptions)) {
    return [];
  }

  return rawOptions
    .map((option) => {
      if (typeof option === 'string') {
        return { name: option, hasCost: false, cost: 0 };
      }

      const cost =
        Number(
          option?.cost ??
            option?.price ??
            option?.additionalCost ??
            option?.extraCost ??
            option?.optionCost ??
            0
        ) || 0;

      return {
        name: option?.name || option?.label,
        hasCost: cost > 0 && option?.hasCost !== false,
        cost,
      };
    })
    .filter((option) => option.name);
};

const validateSelectionsAndGetCost = ({
  menuItem,
  selectedOptions,
  type,
  requiredCount,
  itemName,
}) => {
  const label = type === 'flavor' ? 'flavor' : 'topping';
  const options = normalizeMenuOptions(menuItem, type);
  const selected = Array.isArray(selectedOptions) ? selectedOptions : [];
  const maxCount = Math.min(
    Math.max(0, Number(requiredCount) || options.length),
    options.length
  );

  if (selected.length > maxCount) {
    throw new Error(
      `Please select up to ${maxCount} ${label}${
        maxCount === 1 ? '' : 's'
      } for the "${itemName}"`
    );
  }

  const invalidOption = selected.find((selectedOption) => {
    const optionName =
      typeof selectedOption === 'string'
        ? selectedOption
        : selectedOption?.name || selectedOption?.label || '';
    return !options.some((option) => option.name === optionName);
  });

  if (invalidOption) {
    const invalidName =
      typeof invalidOption === 'string'
        ? invalidOption
        : invalidOption?.name || invalidOption?.label || '';
    throw new Error(
      `Invalid ${label} "${invalidName}" selected for the "${itemName}"`
    );
  }

  return selected.reduce((sum, selectedOption) => {
    const optionName =
      typeof selectedOption === 'string'
        ? selectedOption
        : selectedOption?.name || selectedOption?.label || '';
    const option = options.find((item) => item.name === optionName);
    return sum + (option?.hasCost ? Number(option.cost) || 0 : 0);
  }, 0);
};
/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.validateOrder = async (req, res, next) => {
  try {
    const {
      body: {
        foodTruckId,
        deliveryTime,
        deliveryDate,
        items,
        locationId,
        couponId,
        taxAmount = 0,
        tax,
        tip,
        tips,
        tipsAmount = 0,
        deliveryFee,
        fulfillmentType = 'PICKUP',
        deliveryAddress = null,
        deliveryLat = null,
        deliveryLong = null,
        availabilityId,
        paymentMethod,
        orderSource: incomingOrderSource = 'CUSTOMER_APP',
      },
      user,
    } = req;
    const orderSource = normalizeWalkUpOrderSource(user, incomingOrderSource);
    const vendorPosOrder = isVendorPosOrder(user, orderSource);
    const applyGatewayFee = paymentMethod
      ? isGatewayPaymentMethod(paymentMethod)
      : !vendorPosOrder;
    if (['VENDOR', 'EMPLOYEE'].includes(user?.userType) && !vendorPosOrder) {
      return res.error(new Error('Vendor orders must use the POS flow'), 403);
    }
    let normalizedTaxAmount = toMoney(tax ?? taxAmount);
    const normalizedDeliveryFee = normalizeDeliveryFee(
      fulfillmentType,
      deliveryFee
    );
    const normalizedDriverTip = normalizeDriverTip(fulfillmentType, tip, tips);
    const normalizedFoodTruckTip = toMoney(tipsAmount);

    const menuIds = {};
    const foodTruck = await FoodTruckService.getById(foodTruckId);
    if (!foodTruck) {
      return res.error(new Error('No food truck found'), 409);
    }
    if (
      vendorPosOrder &&
      !assertPosActorFoodTruckAccess(user, foodTruck, locationId)
    ) {
      return res.error(new Error('Food truck not found or access denied'), 404);
    }
    const vendorTierAtTransaction = vendorPosOrder
      ? await assertVendorPosAccess(foodTruck, paymentMethod || 'CASH')
      : null;
    if (vendorPosOrder) {
      await assertActiveEmployeeSession(user);
      await touchEmployeeSession(user);
    }

    if (availabilityId) {
      const avl = !!(foodTruck.availability || []).find(
        (itm) => itm._id.toString() === availabilityId
      );
      if (!avl) {
        return res.error(new Error('Availability mismatch'), 409);
      }
    } else if (
      !vendorPosOrder &&
      !isLocationOpenForNormalOrdering(foodTruck, locationId)
    ) {
      return res.error(
        new Error('This location is closed for normal ordering'),
        409
      );
    }

    (
      await MenuItemService.getWithFoodTruck({
        userId: foodTruck.userId,
        _id: {
          $in: items.map((it) => new mongoose.Types.ObjectId(it.menuItemId)),
        },
      })
    ).forEach((item) => {
      menuIds[item._id.toString()] = item;
    });

    if (items.length !== Object.keys(menuIds).length) {
      return res.error(new Error('Order items mismatched'), 409);
    }

    const menuItems = [];
    let subTotal = 0;
    try {
      items.forEach((item) => {
        console.log('item', item);
        console.log('item', menuIds[item.menuItemId]);
        if (menuIds[item.menuItemId]) {
          if (item.qty < menuIds[item.menuItemId].minQty) {
            throw `Minimum quantity must be ${
              menuIds[item.menuItemId].minQty
            } for the "${menuIds[item.menuItemId].name}"`;
          }
          if (item.qty > menuIds[item.menuItemId].maxQty) {
            throw `Maximum quantity must be ${
              menuIds[item.menuItemId].maxQty
            } for the "${menuIds[item.menuItemId].name}"`;
          }
          const price = menuIds[item.menuItemId].price;
          const name = menuIds[item.menuItemId].name;
          const imgUrls = menuIds[item.menuItemId].imgUrls;
          const description = menuIds[item.menuItemId].description;
          const bogoItemsatrray = menuIds[item.menuItemId].bogoItems;
          const discountType = menuIds[item.menuItemId].discountType;
          const subItemarray = menuIds[item.menuItemId].subItem;
          const itemType = menuIds[item.menuItemId].itemType;
          const hasFlavors = menuIds[item.menuItemId].hasFlavors;
          const flavorsPerOrder = menuIds[item.menuItemId].flavorsPerOrder || 1;
          const selectedFlavors = Array.isArray(item.selectedFlavors)
            ? item.selectedFlavors
            : [];
          const hasToppings = menuIds[item.menuItemId].hasToppings;
          const toppingsPerOrder =
            menuIds[item.menuItemId].toppingsPerOrder || 1;
          const selectedToppings = Array.isArray(item.selectedToppings)
            ? item.selectedToppings
            : [];
          const selectedDiscountFlavors = Array.isArray(
            item.selectedDiscountFlavors
          )
            ? item.selectedDiscountFlavors
            : [];
          const selectedDiscountToppings = Array.isArray(
            item.selectedDiscountToppings
          )
            ? item.selectedDiscountToppings
            : [];
          let selectedOptionsCost = 0;
          let selectedDiscountOptionsCost = 0;

          if (hasFlavors) {
            selectedOptionsCost += validateSelectionsAndGetCost({
              menuItem: menuIds[item.menuItemId],
              selectedOptions: selectedFlavors,
              type: 'flavor',
              requiredCount: flavorsPerOrder,
              itemName: name,
            });
            selectedDiscountOptionsCost += validateSelectionsAndGetCost({
              menuItem: menuIds[item.menuItemId],
              selectedOptions: selectedDiscountFlavors,
              type: 'flavor',
              requiredCount: flavorsPerOrder,
              itemName: name,
            });
          }

          if (hasToppings) {
            selectedOptionsCost += validateSelectionsAndGetCost({
              menuItem: menuIds[item.menuItemId],
              selectedOptions: selectedToppings,
              type: 'topping',
              requiredCount: toppingsPerOrder,
              itemName: name,
            });
            selectedDiscountOptionsCost += validateSelectionsAndGetCost({
              menuItem: menuIds[item.menuItemId],
              selectedOptions: selectedDiscountToppings,
              type: 'topping',
              requiredCount: toppingsPerOrder,
              itemName: name,
            });
          }

          // Handle combo items
          let comboItemsWithDetails = [];
          let comboSubtotal = 0;
          if (
            itemType === 'COMBO' &&
            item.comboItems &&
            item.comboItems.length > 0
          ) {
            item.comboItems.forEach((comboItem) => {
              const subItemMatch = subItemarray.find(
                (sub) => sub._id.toString() === comboItem.comboMenuItemId
              );
              if (subItemMatch) {
                const comboQty = comboItem.qty || 1;
                // const comboTotal = subItemMatch.price * comboQty;
                const comboTotal = 0;

                comboSubtotal += comboTotal;
                comboItemsWithDetails.push({
                  ...subItemMatch,
                  qty: comboQty,
                  total: comboTotal,
                });
              }
            });
          }

          // Clone original data (so we don't mutate the original menu item)
          let updatedFullMenuItemData = { ...menuIds[item.menuItemId] };
          const unitPrice = price + selectedOptionsCost;
          const mainSubtotal = unitPrice * item.qty;
          let itemTotal = mainSubtotal;

          const discountRules = menuIds[item.menuItemId].discountRules;

          // Add combo items to fullMenuItemData
          if (itemType === 'COMBO' && comboItemsWithDetails.length > 0) {
            updatedFullMenuItemData.comboItems = comboItemsWithDetails;
          }

          if (discountRules && discountRules.discount > 0) {
            const {
              buyQty = 1,
              getQty = 1,
              discount: discountVal = 0,
              repeatable = true,
            } = discountRules;

            const eligibleSets = repeatable
              ? Math.floor(item.qty / buyQty)
              : item.qty >= buyQty
              ? 1
              : 0;

            const rewardItems = eligibleSets * getQty;
            const rewardTotal =
              rewardItems * (price + selectedDiscountOptionsCost);
            const discountAmount = rewardItems * price * discountVal;
            const rewardLinePrice =
              price * (1 - discountVal) + selectedDiscountOptionsCost;

            itemTotal = mainSubtotal + rewardTotal - discountAmount;

            // Update bogoItems in updatedFullMenuItemData for front-end display
            updatedFullMenuItemData.bogoItems = [
              {
                itemId: item.menuItemId,
                name: name,
                price: rewardLinePrice,
                qty: rewardItems,
                isSameItem: true,
                discountVal: discountVal,
              },
            ];
          } else {
            // Fallback to old logic if no discountRules
            // ✅ Only replace bogoItems if discount type is "bogo"
            if (discountType && discountType === 'BOGO') {
              updatedFullMenuItemData = {
                ...updatedFullMenuItemData,
                bogoItems: Array.isArray(bogoItemsatrray)
                  ? bogoItemsatrray.map((bogo) => ({
                      ...bogo,
                      price: bogo.isSameItem
                        ? selectedDiscountOptionsCost
                        : bogo.price,
                      qty: item.qty, // update quantity same as parent
                    }))
                  : [],
              };
            }
            // ---------- BOGOHO Discount (Buy One Get One Half Off) ----------
            if (
              !(discountRules && discountRules.discount > 0) &&
              discountType &&
              discountType === 'BOGOHO'
            ) {
              updatedFullMenuItemData = {
                ...updatedFullMenuItemData,
                bogoItems: Array.isArray(bogoItemsatrray)
                  ? bogoItemsatrray.map((bogo) => {
                      const halfPrice = bogo.price / 2;
                      // const bogoTotal = halfPrice * item.qty;
                      const bogoTotal = 0;
                      return {
                        ...bogo,
                        qty: item.qty,
                        halfPrice,
                        total: bogoTotal,
                      };
                    })
                  : [],
              };
              itemTotal =
                mainSubtotal +
                (price * 0.5 + selectedDiscountOptionsCost) * item.qty;
            }

            if (discountType === 'BOGO') {
              itemTotal = mainSubtotal + selectedDiscountOptionsCost * item.qty;
            } else if (discountType === 'BOGOHO') {
              itemTotal =
                mainSubtotal +
                (price * 0.5 + selectedDiscountOptionsCost) * item.qty;
            } else {
              itemTotal = mainSubtotal;
            }
          }

          menuItems.push({
            menuItemId: item.menuItemId,
            customization: item.customization || null,
            selectedFlavors: hasFlavors ? selectedFlavors : [],
            selectedToppings: hasToppings ? selectedToppings : [],
            selectedDiscountFlavors: hasFlavors ? selectedDiscountFlavors : [],
            selectedDiscountToppings: hasToppings
              ? selectedDiscountToppings
              : [],
            optionsTotal: selectedOptionsCost,
            price: unitPrice,
            name: name,
            imgUrls: imgUrls,
            description: description,
            qty: item.qty,
            discountType: discountType || null,
            comboItems: comboItemsWithDetails,
            comboSubtotal: comboSubtotal,
            fullMenuItemData: updatedFullMenuItemData,
            total: itemTotal,
          });

          subTotal += itemTotal;

          // Add combo items subtotal
          // subTotal += comboSubtotal;
        }
      });
    } catch (e) {
      return res.error(new Error(e.message), 409);
    }

    let disAmount = 0;
    if (couponId) {
      const coupon = await CouponService.getById(couponId);
      if (!coupon) {
        return res.error(new Error('Coupon not found'), 409);
      }

      const now = new Date();
      if (
        !coupon.isActive ||
        coupon.status === 'ARCHIVED' ||
        (coupon.validFrom && new Date(coupon.validFrom) > now) ||
        (coupon.validTill && new Date(coupon.validTill) < now)
      ) {
        return res.error(new Error('Invalid or expired coupon'), 409);
      }

      const usageCount = await CouponUsageService.getCount({
        couponId: coupon._id,
        deletedAt: null,
        userId: user._id,
      });

      if (coupon.usageLimit === 'ONCE' && usageCount >= 1) {
        return res.error(
          new Error('You can use this coupon only one time'),
          409
        );
      }

      if (coupon.usageLimit === 'ONCE' && usageCount >= 2) {
        return res.error(
          new Error('You can use this coupon only two time'),
          409
        );
      }

      if (coupon.usageLimit === 'MONTHLY' && usageCount >= 1) {
        return res.error(
          new Error('You can use this coupon only one time per month'),
          409
        );
      }

      if (coupon.type === 'FIXED' && coupon.value > subTotal) {
        return res.error(new Error('You can not apply this coupon'), 409);
      }

      if (coupon.type === 'PERCENTAGE') {
        disAmount = +Number((coupon.value * subTotal) / 100).toFixed(2);
        if (coupon.maxDiscount > 0) {
          disAmount = Math.min(disAmount, coupon.maxDiscount);
        }
      } else {
        disAmount = Math.min(Number(coupon.value) || 0, subTotal);
      }
    }

    const taxableFoodAmount = Math.max(0, subTotal - disAmount);
    let paymentProcessingFee = calculatePlatformServiceFee(
      taxableFoodAmount + normalizedDeliveryFee,
      applyGatewayFee
    );
    const avalaraTax = await calculateAvalaraOrderTax({
      foodTruck,
      locationId,
      fulfillmentType,
      deliveryAddress,
      deliveryLat,
      deliveryLong,
      foodAmount: taxableFoodAmount,
      deliveryFee: normalizedDeliveryFee,
      serviceFee: paymentProcessingFee,
      type: 'SalesOrder',
      commit: false,
      customerCode: user?._id?.toString(),
    });
    if (avalaraTax.result?.success) {
      normalizedTaxAmount = toMoney(avalaraTax.result.totalTax);
    }

    let total =
      subTotal -
      disAmount +
      normalizedDeliveryFee +
      paymentProcessingFee +
      normalizedTaxAmount +
      normalizedDriverTip;
    const loc = avalaraTax.loc;
    total += normalizedFoodTruckTip;

    // const counter = await OrderCounterService.updateTheCounter(foodTruck?._id);

    // Check for free dessert eligibility (one-time per user)
    let freeDessertAmount = 0;
    let isFreeDessertEligible = false;

    const settings = await SettingService.getByData({}, { singleResult: true });
    if (
      !vendorPosOrder &&
      settings?.isFreeDessertEnabled &&
      settings?.freeDessertAmount > 0 &&
      settings?.freeDessertOrderCount > 0
    ) {
      // Count user's completed orders and prior redemptions
      const completedOrders = await Service.getCount({
        userId: user._id,
        orderStatus: { $in: ['DELIVERED', 'COMPLETED'] },
        deletedAt: null,
      });
      const appliedRedemptions = await Service.getCount({
        userId: user._id,
        freeDessertApplied: true,
        deletedAt: null,
      });

      const threshold = Number(settings.freeDessertOrderCount);
      const nextOrderNumber = completedOrders + 1;
      const maxEligibleRedemptions = Math.floor(nextOrderNumber / threshold);

      // Eligible only on exact multiples of the threshold and
      // if user hasn't yet used all redemptions unlocked up to this multiple
      if (
        nextOrderNumber % threshold === 0 &&
        appliedRedemptions < maxEligibleRedemptions
      ) {
        isFreeDessertEligible = true;
        freeDessertAmount = settings.freeDessertAmount;

        // Apply free dessert discount
        total -= freeDessertAmount;
        if (total < 0) total = 0; // Ensure total doesn't go negative
      }
    }
    const orderPlaceData = {
      foodTruckId: foodTruck?._id,
      userId:
        vendorPosOrder && user.userType === 'EMPLOYEE'
          ? user.vendor_user_id
          : user._id,
      createdByUserId:
        vendorPosOrder && user.userType === 'VENDOR' ? user._id : null,
      createdByEmployeeInternalId:
        vendorPosOrder && user.userType === 'EMPLOYEE'
          ? user.employee_internal_id
          : null,
      ...buildWalkUpAuditFields({
        user,
        foodTruck,
        locationId,
        orderSource,
        paymentMethod: paymentMethod || 'CASH',
        plan: vendorTierAtTransaction,
      }),
      orderSource,
      locationId,
      deliveryTime: deliveryTime || null,
      deliveryDate: deliveryDate || null,
      fulfillmentType,
      deliveryAddress:
        fulfillmentType === 'DELIVERY' ? deliveryAddress || null : null,
      couponId,
      availabilityId,
      items: menuItems,
      subTotal: subTotal,
      subtotal: subTotal,
      discount: disAmount,
      // totalAfterDiscount: subTotal + taxAmount - disAmount,
      totalAfterDiscount: subTotal - disAmount,
      taxAmount: normalizedTaxAmount,
      tax: normalizedTaxAmount,
      deliveryFee: normalizedDeliveryFee,
      tip: normalizedDriverTip,
      tips: normalizedDriverTip,
      tipsAmount: normalizedFoodTruckTip,
      paymentProcessingFee,
      totalOrderCost: total,
      total,
      avalaraTaxAmount: avalaraTax.result?.success
        ? normalizedTaxAmount
        : undefined,
      avalaraEstimateStatus: avalaraTax.result?.success ? 'SUCCESS' : 'FAILED',
      avalaraEstimateError: avalaraTax.result?.success
        ? null
        : { message: avalaraTax.result?.message || 'Avalara estimate failed' },
      avalaraEstimateResponse: avalaraTax.result?.data || null,
      freeDessertAmount,
      isFreeDessertEligible,
      freeDessertApplied: isFreeDessertEligible,
      orderStatus: vendorPosOrder ? 'PREPARING' : 'PLACED',
      status: vendorPosOrder ? 'PREPARING' : 'PLACED',
      statusTime: buildInitialStatusTime(
        vendorPosOrder ? 'PREPARING' : 'PLACED'
      ),
    };
    console.log('orderPlaceData', orderPlaceData);
    // const data = await Service.create(orderPlaceData);

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: orderPlaceData },
      `${entityName} validate successfully`
    );
  } catch (e) {
    return next(e);
  }
};

exports.paymentCheckout = async (req, res, next) => {
  try {
    const {
      body: {
        applePayToken = 'd',
        googlePayToken,
        paymentData,
        paymentMethod = 'APPLE_PAY',
        amount,
        taxAmount = 0,
        subTotal = 0,
      },
      user,
    } = req;

    if (!amount || !user) {
      return res.error(new Error('amount and user are required'), 400);
    }

    const opaquePaymentData = normalizeOpaquePaymentData(paymentData);
    const base64String =
      paymentMethod === 'CARD' || paymentMethod === 'TAP_TO_PAY'
        ? opaquePaymentData.opaqueToken
        : Buffer.from(
            paymentMethod === 'APPLE_PAY'
              ? JSON.stringify(paymentData)
              : paymentData
          ).toString('base64');

    const userId =
      user.userType === 'EMPLOYEE' ? user.vendor_user_id || user._id : user._id;
    const email = user.email;
    const firstName = user.firstName || 'Employee';
    const lastName = user.lastName || '';

    // const opaqueToken = applePayToken || googlePayToken;
    const opaqueToken = base64String;
    // console.log(typeof(base64String));
    // console.log("applePayToken",typeof(applePayToken));

    if (!opaqueToken) {
      return res.error(new Error('Payment token missing'), 400);
    }
    if (paymentMethod === 'TAP_TO_PAY') {
      await assertVendorTapToPayAccess(user);
    }

    if (
      paymentMethod === 'TAP_TO_PAY' &&
      opaqueToken === 'MOCK_TOKEN_SUCCESS_SANDBOX_ABELL_DEV'
    ) {
      console.log(
        '🛠️ [TapToPay Test] Frontend sandbox token detected. Bypassing live gateway handshake.'
      );

      return res.data(
        {
          paymentsData: {
            userId,
            transactionId: `tap_to_pay_sandbox_${Date.now()}`,
            authCode: 'SANDBOX_APPROVED',
            status: 'settled',
            amount,
            taxAmount,
            subTotal,
            paymentMethod,
            mode: 'sandbox',
            invoiceNumber: null,
            accountNumber: 'XXXX1111',
            accountType: 'VISA',
            date: new Date().toISOString(),
          },
        },
        'Payment checkout was successful'
      );
    }
    //  CHARGE PAYMENT
    const chargeResp = await PaymentHelper.chargePaymentUnified({
      opaqueToken,
      amount,
      paymentMethod,
      dataDescriptor: opaquePaymentData.dataDescriptor,
      firstName,
      lastName,
      email,
      taxAmount,
      subTotal,
      userId,
    });

    console.log('Payment checkout result', {
      success: chargeResp.success,
      level: chargeResp.level,
      paymentMethod,
      amount,
      transactionId: chargeResp.transactionId || null,
      errorCode: chargeResp.success ? null : chargeResp.code,
      errorMessage: chargeResp.success ? null : chargeResp.message,
    });

    //  LOG PAYMENT ATTEMPT
    await PaymentsLogService.create({
      userId,
      type: 'CHECKOUT',
      requestPayload: {
        opaqueToken,
        amount,
        taxAmount,
        subTotal,
        paymentMethod,
      },
      paymentMethod: paymentMethod,
      responsePayload: chargeResp,
      mode: chargeResp.env,
      level: chargeResp?.level || null,
      amount: Number(amount),
      transactionId:
        chargeResp?.transactionId || chargeResp?.fullResponse?.transId || null,
      authCode:
        chargeResp?.authCode || chargeResp?.fullResponse?.authCode || null,
      response_type: 'charge',
      invoiceNumber: chargeResp?.invoiceNumber,
      accountNumber: chargeResp.accountNumber || null,
      accountType: chargeResp.accountType || null,
      success: chargeResp.success ? true : false,
      errorCode: chargeResp.success ? null : chargeResp.code,
      errorMessage: chargeResp.success ? null : chargeResp.message,
    });

    // PAYMENT FAILED
    if (!chargeResp.success) {
      const failedData = {
        userId,
        transactionId:
          chargeResp?.transactionId ||
          chargeResp?.fullResponse?.transId ||
          null,
        amount,
        taxAmount,
        subTotal,
        paymentMethod,
        mode: chargeResp.env,
        invoiceNumber: chargeResp?.invoiceNumber,
        errorCode: chargeResp.success ? null : chargeResp.code,
        errorMessage: chargeResp.success ? null : chargeResp.message,
        date: new Date().toISOString(),
      };

      try {
        if (user) {
          // await MailHelper.sendPaymentsSuccessAndFailed(user,false,failedData);
        }
      } catch (e) {}

      return res.error(new Error(chargeResp.message || 'Payment failed'), 400);
    }

    // SUCCESS RESPONSE

    const data = {
      userId,
      transactionId: chargeResp.transactionId,
      authCode: chargeResp.authCode,
      amount,
      taxAmount,
      subTotal,
      paymentMethod,
      mode: chargeResp.env,
      invoiceNumber: chargeResp?.invoiceNumber,
      accountNumber: chargeResp.accountNumber || null,
      accountType: chargeResp.accountType || null,
      date: new Date().toISOString(),
    };
    try {
      if (chargeResp.success && user) {
        await MailHelper.sendPaymentsSuccessAndFailed(user, true, data);
      }
    } catch (e) {}

    return res.data({ paymentsData: data }, `Payment checkout was successful`);
  } catch (err) {
    next(err);
  }
};

// exports.paymentTransactionslist = async (req, res, next) => {
//   try {
//     console.log(req.query);
//     let {
//       query: { limit = 10, page = 1, search,status },
//       params: { id: _id },
//       user,
//     } = req;

//     // ========== GET BY ID ==========
//     if (_id) {
//       const result = await PaymentsLogService.getTransactionAllDetails(
//         1,
//         1,
//         user,
//         "",
//         _id
//       );

//       return res.data(
//         {
//           [`${entityName.toLowerCase()}`]: result.data[0] || null,
//         },
//         `${entityName} item`
//       );
//     }

//     // ========== LIST API ==========
//     const result = await PaymentsLogService.getTransactionAllDetails(
//       limit,
//       page,
//       user,
//       search,
//       null,
//       status
//     );

//     return res.data(
//       {
//         [`TransactionsList`]: result.data,
//         total: result.totalTransactions,
//         successCount: result.successCount,
//         failedCount: result.failedCount,
//         totalSuccessAmount: result.totalSuccessAmount,
//         page,
//         totalPages:
//           result.totalTransactions < limit
//             ? 1
//             : Math.ceil(result.totalTransactions / limit),
//       },
//       `Transactions list get successfully`
//     );
//   } catch (e) {
//     console.log(e);
//     return next(e);
//   }
// };

exports.paymentTransactionslist = async (req, res, next) => {
  try {
    let {
      query: {
        limit = 10,
        page = 1,
        search = '',
        status = null,
        transactionsType = null,
        startDate = null,
        endDate = null,
      },
      params: { id: _id },
      user,
    } = req;
    // Convert to numbers
    limit = Number(limit);
    page = Number(page);

    // Convert status properly (because query always comes as string)
    if (status === 'true') status = true;
    else if (status === 'false') status = false;
    else status = null; // all

    //  GET BY ID
    if (_id) {
      const result = await PaymentsLogService.getTransactionAllDetails(
        1,
        1,
        user,
        '',
        _id,
        null,
        null,
        null
      );

      return res.data(
        { transaction: result.data[0] || null },
        `Transaction item`
      );
    }

    //  LIST API
    const result = await PaymentsLogService.getTransactionAllDetails(
      limit,
      page,
      user,
      search,
      null,
      status,
      transactionsType,
      startDate,
      endDate
    );

    return res.data(
      {
        TransactionsList: result.data,
        total: result.totalTransactions,
        successCount: result.successCount,
        failedCount: result.failedCount,
        totalSuccessAmount: result.totalSuccessAmount,
        page,
        totalPages:
          result.totalTransactions < limit
            ? 1
            : Math.ceil(result.totalTransactions / limit),
      },
      `Transactions list fetched successfully`
    );
  } catch (e) {
    console.log(e);
    return next(e);
  }
};

exports.refundPayment = async (req, res, next) => {
  try {
    const { orderId, transactionId, amount } = req.body;

    const entityName = 'Order';

    if (!orderId || !transactionId || !amount) {
      return res.error(
        new Error('orderId, transactionId and amount required'),
        400
      );
    }

    // Get order details
    const order = await Service.getById(orderId);
    if (!order) {
      return res.error(new Error('Order not found'), 404);
    }

    const resp = await PaymentHelper.processRefund({
      transactionId,
      amount,
    });

    // Create payment log only if not skipLog
    if (!resp.skipLog) {
      await PaymentsLogService.create({
        // userId: order.userId,
        // orderId: orderId,
        type: 'REFUND',
        mode: resp.env,
        level: resp?.level || null,
        amount: Number(amount),
        requestPayload: req.body,
        responsePayload: resp,
        transactionId: transactionId,
        uniqueId:
          resp?.refundTransactionId || resp?.fullResponse?.transId || null,
        authCode: resp?.authCode || resp?.fullResponse?.authCode || null,
        response_type: resp.success
          ? resp?.mode === 'void'
            ? 'VOID'
            : 'REFUND'
          : 'REFUND',

        accountNumber: resp.accountNumber || null,
        accountType: resp.accountType || null,
        success: resp.success ? true : false,
        errorCode: resp.success ? null : resp.code,
        errorMessage: resp.success ? null : resp.message,
      });
    }

    if (!resp.success) {
      return res.error(new Error(resp.message || 'Refund/void failed'), 400);
    }

    // Update order payment status and refund details
    if (resp.success) {
      order.paymentStatus = 'REFUNDED';
      order.refundTransactionId =
        resp?.refundTransactionId || resp?.fullResponse?.transId || null;
      order.refundDateTime = new Date();
      order.refundStatus = 'SUCCESS';
      order.refundReason = 'Manual refund';
      order.refundMode = resp?.mode === 'void' ? 'VOID' : 'REFUND';

      // Update original payment log
      try {
        const paymentLog = await PaymentsLogService.getByData(
          { transactionId, orderId, type: 'CHECKOUT', deletedAt: null },
          { singleResult: true }
        );
        if (paymentLog) {
          paymentLog.orderPaymentStatus = 'REFUNDED';
          await paymentLog.save();
        }
      } catch (err) {
        console.error('Payment log update failed:', err);
      }
    } else {
      order.refundStatus = 'FAILED';
      order.refundErrorMessage = resp.message;
    }
    await order.save();

    return res.data(
      { [entityName.toLowerCase()]: resp },
      `${entityName} refund processed successfully`
    );
  } catch (err) {
    next(err);
  }
};

exports.refundPosOrder = async (req, res, next) => {
  try {
    const {
      params: { id },
      body: { reason = 'Customer requested refund' },
      user,
    } = req;

    const order = await Service.getById(id);
    if (!order) {
      return res.error(new Error('Order not found'), 404);
    }

    if (order.orderSource !== 'VENDOR_POS') {
      return res.error(
        new Error('Only POS orders can be refunded from vendor checkout'),
        409
      );
    }

    const foodTruck = await FoodTruckService.getByData(
      { _id: order.foodTruckId, userId: user._id },
      { singleResult: true }
    );

    if (!foodTruck) {
      return res.error(new Error('Order not found or access denied'), 404);
    }

    if (order.paymentStatus === 'REFUNDED') {
      return res.error(new Error('Order has already been refunded'), 409);
    }

    if (!['PREPARING', 'READY_FOR_PICKUP'].includes(order.orderStatus)) {
      return res.error(
        new Error(
          'Order can only be refunded while preparing or ready for pickup'
        ),
        409
      );
    }

    const refundReason = reason || 'Customer requested refund';
    let refundResponse = {
      success: true,
      mode: isCashPaymentMethod(order.paymentMethod) ? 'cash' : null,
      amount: 0,
      message: 'Cash refund recorded',
    };

    if (isGatewayPaymentMethod(order.paymentMethod)) {
      if (!order.transactionId) {
        return res.error(new Error('Order transaction is missing'), 409);
      }

      const refundAmount = Math.max(
        0,
        toMoney((order.total || 0) - (order.tipsAmount || 0))
      );

      if (refundAmount <= 0) {
        return res.error(
          new Error('Refund amount must be greater than zero'),
          409
        );
      }

      refundResponse = await PaymentHelper.processRefund({
        transactionId: order.transactionId,
        amount: refundAmount,
      });

      if (!refundResponse.skipLog) {
        await PaymentsLogService.create({
          userId: order.userId,
          orderId: order._id,
          type: 'REFUND',
          mode: refundResponse.env,
          level: refundResponse?.level || null,
          amount: Number(refundAmount),
          requestPayload: {
            orderId: order._id,
            transactionId: order.transactionId,
            amount: refundAmount,
            reason: refundReason,
            excludedTip: toMoney(order.tipsAmount || 0),
          },
          responsePayload: refundResponse,
          transactionId: order.transactionId,
          uniqueId: refundResponse?.refundTransactionId || null,
          authCode: refundResponse?.authCode || null,
          response_type: refundResponse.success
            ? refundResponse?.mode === 'void'
              ? 'VOID'
              : 'REFUND'
            : 'REFUND',
          accountNumber: refundResponse.accountNumber || null,
          accountType: refundResponse.accountType || null,
          success: refundResponse.success,
          errorCode: refundResponse.success ? null : refundResponse.code,
          errorMessage: refundResponse.success ? null : refundResponse.message,
        });
      }

      if (!refundResponse.success) {
        order.refundStatus = 'FAILED';
        order.refundErrorMessage = refundResponse.message;
        await order.save();
        return res.error(
          new Error(refundResponse.message || 'Refund/void failed'),
          400
        );
      }
    }

    order.paymentStatus = 'REFUNDED';
    order.orderStatus = 'CANCEL';
    order.status = 'CANCEL';
    order.statusTime = order.statusTime || {
      placedAt: order.createdAt,
      canceledAt: null,
      acceptedAt: null,
      rejectedAt: null,
      preparingAt: null,
      readyAt: null,
      driverPickedUpAt: null,
      deliveredAt: null,
      completedAt: null,
    };
    order.statusTime.canceledAt = new Date().toISOString();
    order.refundTransactionId = refundResponse?.refundTransactionId || null;
    order.refundDateTime = new Date();
    order.refundStatus = 'SUCCESS';
    order.refundReason = refundReason;
    order.refundMode = isGatewayPaymentMethod(order.paymentMethod)
      ? refundResponse?.mode === 'void'
        ? 'VOID'
        : 'REFUND'
      : null;
    order.refundErrorMessage = null;
    await order.save();

    return res.data(
      { order, refund: refundResponse },
      'Order refund processed successfully'
    );
  } catch (err) {
    return next(err);
  }
};

/**
 * To list out or find data by id of given collection
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.list = async (req, res, next) => {
  try {
    let {
      query: { limit = 10, page = 1, search, orderStatus, advance },
      params: { id: _id },
      user,
    } = req;
    if (_id) {
      const { data, total } = await Service.getWithAllDetails(
        1,
        1,
        user,
        '',
        _id
      );
      return res.data(
        { [`${entityName.toLocaleLowerCase()}`]: data[0] },
        `${entityName} item`
      );
    }

    if (orderStatus) {
      orderStatus = orderStatus.split(',').map((item) => item.trim());
      if (
        !!orderStatus.find(
          (itm) =>
            ![
              'CANCEL',
              'PLACED',
              'ACCEPTED',
              'REJECTED',
              'PREPARING',
              'READY_FOR_PICKUP',
              'DRIVER_PICKED_UP',
              'DELIVERED',
              'COMPLETED',
            ].includes(itm)
        )
      ) {
        return res.error(new Error('Invalid "orderStatus"'), 409);
      }
    }

    const { data, total } = await Service.getWithAllDetails(
      limit,
      page,
      user,
      search,
      null,
      orderStatus,
      advance
    );

    return res.data(
      {
        [`${entityName.toLocaleLowerCase()}List`]: data,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      `${entityName} items`
    );
  } catch (e) {
    console.log(e);
    return next(e);
  }
};

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
//old one
// exports.add = async (req, res, next) => {
//   try {
//     const {
//       body: {
//         foodTruckId,
//         deliveryTime,
//         deliveryDate,
//         items,
//         paymentMethod,
//         paymentStatus,
//         transactionId = null,
//         authCode = null,
//         invoiceNumber = null,
//         accountNumber = null,
//         accountType = null,
//         locationId,
//         couponId,
//         taxAmount = 0,
//         tipsAmount=0,
//         availabilityId,
//       },
//       user,
//     } = req;

//     const menuIds = {};
//     const foodTruck = await FoodTruckService.getById(foodTruckId);
//     if (!foodTruck) {
//       return res.error(new Error('No food truck found'), 409);
//     }

//     if (availabilityId) {
//       const avl = !!(foodTruck.availability || []).find(
//         (itm) => itm._id.toString() === availabilityId
//       );
//       if (!avl) {
//         return res.error(new Error('Availability mismatch'), 409);
//       }
//     }

//     (
//       await MenuItemService.getWithFoodTruck({
//         userId: foodTruck.userId,
//         _id: {
//           $in: items.map((it) => new mongoose.Types.ObjectId(it.menuItemId)),
//         },
//       })
//     ).forEach((item) => {
//       menuIds[item._id.toString()] = item;
//     });

//     if (items.length !== Object.keys(menuIds).length) {
//       return res.error(new Error('Order items mismatched'), 409);
//     }

//     const menuItems = [];
//     let subTotal = 0;

//     try {
//       items.forEach((item) => {
//         if (menuIds[item.menuItemId]) {
//           if (item.qty < menuIds[item.menuItemId].minQty) {
//             throw `Minimum quantity must be ${menuIds[item.menuItemId].minQty
//             } for the "${menuIds[item.menuItemId].name}"`;
//           }
//           if (item.qty > menuIds[item.menuItemId].maxQty) {
//             throw `Maximum quantity must be ${menuIds[item.menuItemId].maxQty
//             } for the "${menuIds[item.menuItemId].name}"`;
//           }
//           const price = menuIds[item.menuItemId].price;
//           const name = menuIds[item.menuItemId].name;
//           const imgUrls = menuIds[item.menuItemId].imgUrls;
//           const description = menuIds[item.menuItemId].description;
//           const bogoItemsatrray = menuIds[item.menuItemId].bogoItems;
//           const discountType = menuIds[item.menuItemId].discountType;
//           // Clone original data (so we don't mutate the original menu item)
//           let updatedFullMenuItemData = { ...menuIds[item.menuItemId] };
//           const mainSubtotal = price * item.qty;
//           let bogohoSubtotal = 0;
//           // ✅ Only replace bogoItems if discount type is "bogo"
//           if (discountType && discountType === 'BOGO') {
//             updatedFullMenuItemData = {
//               ...menuIds[item.menuItemId],
//               bogoItems: Array.isArray(bogoItemsatrray)
//                 ? bogoItemsatrray.map((bogo) => ({
//                   ...bogo,
//                   qty: item.qty, // update quantity same as parent
//                 }))
//                 : [],
//             };
//           }

//           // ---------- BOGOHO Discount (Buy One Get One Half Off) ----------
//           if (discountType && discountType === 'BOGOHO') {
//             updatedFullMenuItemData = {
//               ...menuIds[item.menuItemId],
//               bogoItems: Array.isArray(bogoItemsatrray)
//                 ? bogoItemsatrray.map((bogo) => {
//                   const halfPrice = bogo.price / 2;
//                   const bogoTotal = halfPrice * item.qty;

//                   // Add BOGOHO price to subtotal
//                   bogohoSubtotal += bogoTotal;

//                   return {
//                     ...bogo,
//                     qty: item.qty,
//                     halfPrice,
//                     total: bogoTotal,
//                   };
//                 })
//                 : [],
//             };
//           }

//           menuItems.push({
//             menuItemId: item.menuItemId,
//             customization: item.customization || null,
//             price: price,
//             name: name,
//             imgUrls: imgUrls,
//             description: description,
//             qty: item.qty,
//             fullMenuItemData: updatedFullMenuItemData,
//             total: price * item.qty,
//           });

//           if (discountType === 'BOGOHO') {
//             subTotal += mainSubtotal + bogohoSubtotal;
//           } else {
//             subTotal += mainSubtotal;
//           }
//           // subTotal += price * item.qty;
//         }
//       });
//     } catch (e) {
//       return res.error(new Error(e.message), 409);
//     }

//     // subTotal += taxAmount || 0;

//     let disAmount = 0;
//     if (couponId) {
//       const coupon = await CouponService.getById(couponId);
//       if (!coupon) {
//         return res.error(new Error('Coupon not found'), 409);
//       }

//       const usageCount = await CouponUsageService.getCount({
//         couponId: coupon._id,
//         deletedAt: null,
//         userId: user._id,
//       });

//       if (coupon.usageLimit === 'ONCE' && usageCount >= 1) {
//         return res.error(
//           new Error('You can use this coupon only one time'),
//           409
//         );
//       }

//       if (coupon.usageLimit === 'ONCE' && usageCount >= 2) {
//         return res.error(
//           new Error('You can use this coupon only two time'),
//           409
//         );
//       }

//       if (coupon.usageLimit === 'MONTHLY' && usageCount >= 1) {
//         return res.error(
//           new Error('You can use this coupon only one time per month'),
//           409
//         );
//       }

//       if (coupon.type === 'FIXED' && coupon.value > subTotal) {
//         return res.error(new Error('You can not apply this coupon'), 409);
//       }

//       disAmount = +Number((coupon.value * subTotal) / 100).toFixed(2);
//     }

//     let total = subTotal + taxAmount + tipsAmount - disAmount;
//     let paymentProcessingFee = 0;
//     const loc = foodTruck.locations.find(
//       (itm) => itm.zipcode && itm._id.toString() === locationId
//     );
//     if (loc) {
//       const tax = await TaxRatesService.getByData(
//         { zip: loc.zipcode },
//         { singleResult: true }
//       );

//       // taxAmount = ((tax?.estimatedCombineRate || 0) * total) / 100;
//       // total += taxAmount || 0 ;

//       paymentProcessingFee = (3.5 * total) / 100;
//       total += paymentProcessingFee;
//     }

//     const counter = await OrderCounterService.updateTheCounter(foodTruck?._id);

//     // Check for free dessert eligibility (one-time per user)
//     let freeDessertAmount = 0;
//     let isFreeDessertEligible = false;

//     const settings = await SettingService.getByData({}, { singleResult: true });
//     if (
//       settings?.isFreeDessertEnabled &&
//       settings?.freeDessertAmount > 0 &&
//       settings?.freeDessertOrderCount > 0
//     ) {
//       // Count user's completed orders and prior redemptions
//       const completedOrders = await Service.getCount({
//         userId: user._id,
//         orderStatus: 'COMPLETED',
//         deletedAt: null,
//       });
//       const appliedRedemptions = await Service.getCount({
//         userId: user._id,
//         freeDessertApplied: true,
//         deletedAt: null,
//       });

//       const threshold = Number(settings.freeDessertOrderCount);
//       const nextOrderNumber = completedOrders + 1;
//       const maxEligibleRedemptions = Math.floor(nextOrderNumber / threshold);

//       // Eligible only on exact multiples of the threshold and
//       // if user hasn't yet used all redemptions unlocked up to this multiple
//       if (
//         nextOrderNumber % threshold === 0 &&
//         appliedRedemptions < maxEligibleRedemptions
//       ) {
//         isFreeDessertEligible = true;
//         freeDessertAmount = settings.freeDessertAmount;

//         // Apply free dessert discount
//         total -= freeDessertAmount;
//         if (total < 0) total = 0; // Ensure total doesn't go negative
//       }
//     }
//     const data = await Service.create({
//       foodTruckId: foodTruck?._id,
//       userId: user._id,
//       locationId,
//       deliveryTime: deliveryTime || null,
//       deliveryDate: deliveryDate || null,
//       couponId,
//       availabilityId,
//       items: menuItems,
//       locationData: loc || null,
//       subTotal: subTotal,
//       discount: disAmount,
//       // totalAfterDiscount: subTotal + taxAmount - disAmount,
//       totalAfterDiscount: subTotal - disAmount,
//       taxAmount,
//       tipsAmount,
//       paymentProcessingFee,
//       total,
//       freeDessertAmount,
//       isFreeDessertEligible,
//       freeDessertApplied: isFreeDessertEligible,
//       orderStatus: 'PLACED',
//       orderNumber: counter.sequenceValue,
//       paymentMethod,
//       paymentStatus,
//       transactionId,
//       authCode,
//       invoiceNumber,
//       accountNumber,
//       accountType,
//       statusTime: {
//         placedAt: new Date().toISOString(),
//         canceledAt: null,
//         acceptedAt: null,
//         rejectedAt: null,
//         preparingAt: null,
//         readyAt: null,
//         completedAt: null,
//       },
//     });

//     if (couponId) {
//       await CouponUsageService.create({ couponId, userId: user._id });
//     }

//     // UPDATE PAYMENT LOG AFTER ORDER CREATION (NON-COD)
//     if (paymentMethod !== 'COD') {
//       try {
//         const paymentLog = await PaymentsLogService.getByData(
//           {
//             transactionId: transactionId,
//             userId: user._id,
//             deletedAt: null,
//           },
//           { singleResult: true }
//         );

//         if (paymentLog) {
//           paymentLog.orderId = data._id;
//           paymentLog.orderPaymentStatus = 'PAID';

//           await paymentLog.save();
//         }
//       } catch (err) {
//         console.error('Payment log update failed:', err);
//       }
//     }

//     try {
//       await CustomNotification.sendNewOrderNotification(
//         { _id: foodTruck.userId },
//         data._id
//       );
//     } catch (e) { }

//     return res.data(
//       { [`${entityName.toLocaleLowerCase()}`]: data },
//       `${entityName} added`
//     );
//   } catch (e) {
//     return next(e);
//   }
// };
exports.add = async (req, res, next) => {
  try {
    const {
      body: {
        foodTruckId,
        deliveryTime,
        deliveryDate,
        items,
        paymentMethod,
        paymentStatus,
        transactionId = null,
        authCode = null,
        invoiceNumber = null,
        accountNumber = null,
        accountType = null,
        locationId,
        couponId,
        taxAmount = 0,
        tax,
        tip,
        tips,
        tipsAmount = 0,
        deliveryFee,
        fulfillmentType = 'PICKUP',
        deliveryAddress = null,
        deliveryLat = null,
        deliveryLong = null,
        availabilityId,
        orderSource: incomingOrderSource = 'CUSTOMER_APP',
        guestCustomer = {},
      },
      user,
    } = req;
    const orderSource = normalizeWalkUpOrderSource(user, incomingOrderSource);
    const vendorPosOrder = isVendorPosOrder(user, orderSource);
    const initialOrderStatus = vendorPosOrder ? 'PREPARING' : 'PLACED';
    const normalizedPaymentMethod =
      paymentMethod || (vendorPosOrder ? 'CASH' : 'COD');
    const normalizedPaymentStatus =
      paymentStatus ||
      (isCashPaymentMethod(normalizedPaymentMethod) ? 'PENDING' : 'PAID');
    if (['VENDOR', 'EMPLOYEE'].includes(user?.userType) && !vendorPosOrder) {
      return res.error(new Error('Vendor orders must use the POS flow'), 403);
    }
    let normalizedTaxAmount = toMoney(tax ?? taxAmount);
    const normalizedDeliveryFee = normalizeDeliveryFee(
      fulfillmentType,
      deliveryFee
    );
    const normalizedDriverTip = normalizeDriverTip(fulfillmentType, tip, tips);
    const normalizedFoodTruckTip = toMoney(tipsAmount);

    const menuIds = {};
    const foodTruck = await FoodTruckService.getById(foodTruckId);
    if (!foodTruck) {
      return res.error(new Error('No food truck found'), 409);
    }
    if (
      vendorPosOrder &&
      !assertPosActorFoodTruckAccess(user, foodTruck, locationId)
    ) {
      return res.error(new Error('Food truck not found or access denied'), 404);
    }
    const vendorTierAtTransaction = vendorPosOrder
      ? await assertVendorPosAccess(foodTruck, normalizedPaymentMethod)
      : null;
    if (vendorPosOrder) {
      await assertActiveEmployeeSession(user);
      await touchEmployeeSession(user);
    }

    if (availabilityId) {
      const avl = !!(foodTruck.availability || []).find(
        (itm) => itm._id.toString() === availabilityId
      );
      if (!avl) {
        return res.error(new Error('Availability mismatch'), 409);
      }
    } else if (
      !vendorPosOrder &&
      !isLocationOpenForNormalOrdering(foodTruck, locationId)
    ) {
      return res.error(
        new Error('This location is closed for normal ordering'),
        409
      );
    }

    (
      await MenuItemService.getWithFoodTruck({
        userId: foodTruck.userId,
        _id: {
          $in: items.map((it) => new mongoose.Types.ObjectId(it.menuItemId)),
        },
      })
    ).forEach((item) => {
      menuIds[item._id.toString()] = item;
    });

    if (items.length !== Object.keys(menuIds).length) {
      return res.error(new Error('Order items mismatched'), 409);
    }

    const menuItems = [];
    let subTotal = 0;

    try {
      items.forEach((item) => {
        if (menuIds[item.menuItemId]) {
          if (item.qty < menuIds[item.menuItemId].minQty) {
            throw `Minimum quantity must be ${
              menuIds[item.menuItemId].minQty
            } for the "${menuIds[item.menuItemId].name}"`;
          }
          if (item.qty > menuIds[item.menuItemId].maxQty) {
            throw `Maximum quantity must be ${
              menuIds[item.menuItemId].maxQty
            } for the "${menuIds[item.menuItemId].name}"`;
          }
          const price = menuIds[item.menuItemId].price;
          const name = menuIds[item.menuItemId].name;
          const imgUrls = menuIds[item.menuItemId].imgUrls;
          const description = menuIds[item.menuItemId].description;
          const bogoItemsatrray = menuIds[item.menuItemId].bogoItems;
          const discountType = menuIds[item.menuItemId].discountType;
          const subItemarray = menuIds[item.menuItemId].subItem;
          const itemType = menuIds[item.menuItemId].itemType;
          const hasFlavors = menuIds[item.menuItemId].hasFlavors;
          const flavorsPerOrder = menuIds[item.menuItemId].flavorsPerOrder || 1;
          const selectedFlavors = Array.isArray(item.selectedFlavors)
            ? item.selectedFlavors
            : [];
          const hasToppings = menuIds[item.menuItemId].hasToppings;
          const toppingsPerOrder =
            menuIds[item.menuItemId].toppingsPerOrder || 1;
          const selectedToppings = Array.isArray(item.selectedToppings)
            ? item.selectedToppings
            : [];
          const selectedDiscountFlavors = Array.isArray(
            item.selectedDiscountFlavors
          )
            ? item.selectedDiscountFlavors
            : [];
          const selectedDiscountToppings = Array.isArray(
            item.selectedDiscountToppings
          )
            ? item.selectedDiscountToppings
            : [];
          let selectedOptionsCost = 0;
          let selectedDiscountOptionsCost = 0;

          if (hasFlavors) {
            selectedOptionsCost += validateSelectionsAndGetCost({
              menuItem: menuIds[item.menuItemId],
              selectedOptions: selectedFlavors,
              type: 'flavor',
              requiredCount: flavorsPerOrder,
              itemName: name,
            });
            selectedDiscountOptionsCost += validateSelectionsAndGetCost({
              menuItem: menuIds[item.menuItemId],
              selectedOptions: selectedDiscountFlavors,
              type: 'flavor',
              requiredCount: flavorsPerOrder,
              itemName: name,
            });
          }

          if (hasToppings) {
            selectedOptionsCost += validateSelectionsAndGetCost({
              menuItem: menuIds[item.menuItemId],
              selectedOptions: selectedToppings,
              type: 'topping',
              requiredCount: toppingsPerOrder,
              itemName: name,
            });
            selectedDiscountOptionsCost += validateSelectionsAndGetCost({
              menuItem: menuIds[item.menuItemId],
              selectedOptions: selectedDiscountToppings,
              type: 'topping',
              requiredCount: toppingsPerOrder,
              itemName: name,
            });
          }

          // Handle combo items
          let comboItemsWithDetails = [];
          let comboSubtotal = 0;
          if (
            itemType === 'COMBO' &&
            item.comboItems &&
            item.comboItems.length > 0
          ) {
            item.comboItems.forEach((comboItem) => {
              const subItemMatch = subItemarray.find(
                (sub) => sub._id.toString() === comboItem.comboMenuItemId
              );
              if (subItemMatch) {
                const comboQty = comboItem.qty || 1;
                // const comboTotal = subItemMatch.price * comboQty;
                const comboTotal = 0;

                comboSubtotal += comboTotal;
                comboItemsWithDetails.push({
                  ...subItemMatch,
                  qty: comboQty,
                  total: comboTotal,
                });
              }
            });
          }

          // Clone original data (so we don't mutate the original menu item)
          let updatedFullMenuItemData = { ...menuIds[item.menuItemId] };
          const unitPrice = price + selectedOptionsCost;
          const mainSubtotal = unitPrice * item.qty;
          let itemTotal = mainSubtotal;
          const discountRules = menuIds[item.menuItemId].discountRules;

          // Add combo items to fullMenuItemData
          if (itemType === 'COMBO' && comboItemsWithDetails.length > 0) {
            updatedFullMenuItemData.comboItems = comboItemsWithDetails;
          }

          // ✅ Only replace bogoItems if discount type is "bogo"
          if (discountRules && discountRules.discount > 0) {
            const {
              buyQty = 1,
              getQty = 1,
              discount: discountVal = 0,
              repeatable = true,
            } = discountRules;
            const normalizedBuyQty = Math.max(1, Number(buyQty) || 1);
            const normalizedGetQty = Math.max(1, Number(getQty) || 1);
            const eligibleSets = repeatable
              ? Math.floor(item.qty / normalizedBuyQty)
              : item.qty >= normalizedBuyQty
              ? 1
              : 0;
            const rewardItems = eligibleSets * normalizedGetQty;
            const rewardTotal =
              rewardItems * (price + selectedDiscountOptionsCost);
            const discountAmount = rewardItems * price * discountVal;
            const rewardLinePrice =
              price * (1 - discountVal) + selectedDiscountOptionsCost;

            itemTotal = mainSubtotal + rewardTotal - discountAmount;
            updatedFullMenuItemData.bogoItems = [
              {
                itemId: item.menuItemId,
                name: name,
                price: rewardLinePrice,
                qty: rewardItems,
                isSameItem: true,
                discountVal: discountVal,
              },
            ];
          } else {
            if (discountType && discountType === 'BOGO') {
              updatedFullMenuItemData = {
                ...updatedFullMenuItemData,
                bogoItems: Array.isArray(bogoItemsatrray)
                  ? bogoItemsatrray.map((bogo) => ({
                      ...bogo,
                      price: bogo.isSameItem
                        ? selectedDiscountOptionsCost
                        : bogo.price,
                      qty: item.qty,
                    }))
                  : [],
              };
              itemTotal = mainSubtotal + selectedDiscountOptionsCost * item.qty;
            }

            if (discountType && discountType === 'BOGOHO') {
              updatedFullMenuItemData = {
                ...updatedFullMenuItemData,
                bogoItems: Array.isArray(bogoItemsatrray)
                  ? bogoItemsatrray.map((bogo) => {
                      const halfPrice = bogo.price / 2;
                      const bogoTotal = 0;

                      return {
                        ...bogo,
                        qty: item.qty,
                        halfPrice,
                        total: bogoTotal,
                      };
                    })
                  : [],
              };
              itemTotal =
                mainSubtotal +
                (price * 0.5 + selectedDiscountOptionsCost) * item.qty;
            }
          }

          menuItems.push({
            menuItemId: item.menuItemId,
            customization: item.customization || null,
            selectedFlavors: hasFlavors ? selectedFlavors : [],
            selectedToppings: hasToppings ? selectedToppings : [],
            selectedDiscountFlavors: hasFlavors ? selectedDiscountFlavors : [],
            selectedDiscountToppings: hasToppings
              ? selectedDiscountToppings
              : [],
            optionsTotal: selectedOptionsCost,
            price: unitPrice,
            name: name,
            imgUrls: imgUrls,
            description: description,
            qty: item.qty,
            discountType: discountType || null,
            comboItems: comboItemsWithDetails,
            comboSubtotal: comboSubtotal,
            fullMenuItemData: updatedFullMenuItemData,
            total: itemTotal,
          });

          subTotal += itemTotal;

          // Add combo items subtotal
          // subTotal += comboSubtotal;
        }
      });
    } catch (e) {
      return res.error(new Error(e.message), 409);
    }

    // subTotal += taxAmount || 0;

    let disAmount = 0;
    if (couponId) {
      const coupon = await CouponService.getById(couponId);
      if (!coupon) {
        return res.error(new Error('Coupon not found'), 409);
      }

      const now = new Date();
      if (
        !coupon.isActive ||
        coupon.status === 'ARCHIVED' ||
        (coupon.validFrom && new Date(coupon.validFrom) > now) ||
        (coupon.validTill && new Date(coupon.validTill) < now)
      ) {
        return res.error(new Error('Invalid or expired coupon'), 409);
      }

      const usageCount = await CouponUsageService.getCount({
        couponId: coupon._id,
        deletedAt: null,
        userId: user._id,
      });

      if (coupon.usageLimit === 'ONCE' && usageCount >= 1) {
        return res.error(
          new Error('You can use this coupon only one time'),
          409
        );
      }

      if (coupon.usageLimit === 'ONCE' && usageCount >= 2) {
        return res.error(
          new Error('You can use this coupon only two time'),
          409
        );
      }

      if (coupon.usageLimit === 'MONTHLY' && usageCount >= 1) {
        return res.error(
          new Error('You can use this coupon only one time per month'),
          409
        );
      }

      if (coupon.type === 'FIXED' && coupon.value > subTotal) {
        return res.error(new Error('You can not apply this coupon'), 409);
      }

      if (coupon.type === 'PERCENTAGE') {
        disAmount = +Number((coupon.value * subTotal) / 100).toFixed(2);
        if (coupon.maxDiscount > 0) {
          disAmount = Math.min(disAmount, coupon.maxDiscount);
        }
      } else {
        disAmount = Math.min(Number(coupon.value) || 0, subTotal);
      }
    }

    const taxableFoodAmount = Math.max(0, subTotal - disAmount);
    let paymentProcessingFee = calculatePlatformServiceFee(
      taxableFoodAmount + normalizedDeliveryFee,
      isGatewayPaymentMethod(normalizedPaymentMethod)
    );
    const avalaraEstimate = await calculateAvalaraOrderTax({
      foodTruck,
      locationId,
      fulfillmentType,
      deliveryAddress,
      deliveryLat,
      deliveryLong,
      foodAmount: taxableFoodAmount,
      deliveryFee: normalizedDeliveryFee,
      serviceFee: paymentProcessingFee,
      type: 'SalesOrder',
      commit: false,
      customerCode: user?._id?.toString(),
    });
    if (avalaraEstimate.result?.success) {
      normalizedTaxAmount = toMoney(avalaraEstimate.result.totalTax);
    }

    let total =
      subTotal -
      disAmount +
      normalizedDeliveryFee +
      paymentProcessingFee +
      normalizedTaxAmount +
      normalizedDriverTip;
    const loc = avalaraEstimate.loc;
    total += normalizedFoodTruckTip;

    const counter = await OrderCounterService.updateTheCounter(foodTruck?._id);

    // Check for free dessert eligibility (one-time per user)
    let freeDessertAmount = 0;
    let isFreeDessertEligible = false;

    const settings = await SettingService.getByData({}, { singleResult: true });
    if (
      !vendorPosOrder &&
      settings?.isFreeDessertEnabled &&
      settings?.freeDessertAmount > 0 &&
      settings?.freeDessertOrderCount > 0
    ) {
      // Count user's completed orders and prior redemptions
      const completedOrders = await Service.getCount({
        userId: user._id,
        orderStatus: { $in: ['DELIVERED', 'COMPLETED'] },
        deletedAt: null,
      });
      const appliedRedemptions = await Service.getCount({
        userId: user._id,
        freeDessertApplied: true,
        deletedAt: null,
      });

      const threshold = Number(settings.freeDessertOrderCount);
      const nextOrderNumber = completedOrders + 1;
      const maxEligibleRedemptions = Math.floor(nextOrderNumber / threshold);

      // Eligible only on exact multiples of the threshold and
      // if user hasn't yet used all redemptions unlocked up to this multiple
      if (
        nextOrderNumber % threshold === 0 &&
        appliedRedemptions < maxEligibleRedemptions
      ) {
        isFreeDessertEligible = true;
        freeDessertAmount = settings.freeDessertAmount;

        // Apply free dessert discount
        total -= freeDessertAmount;
        if (total < 0) total = 0; // Ensure total doesn't go negative
      }
    }
    const data = await Service.create({
      foodTruckId: foodTruck?._id,
      userId:
        vendorPosOrder && user.userType === 'EMPLOYEE'
          ? user.vendor_user_id
          : user._id,
      createdByUserId:
        vendorPosOrder && user.userType === 'VENDOR' ? user._id : null,
      createdByEmployeeInternalId:
        vendorPosOrder && user.userType === 'EMPLOYEE'
          ? user.employee_internal_id
          : null,
      ...buildWalkUpAuditFields({
        user,
        foodTruck,
        locationId,
        orderSource,
        paymentMethod: normalizedPaymentMethod,
        plan: vendorTierAtTransaction,
      }),
      orderSource,
      guestCustomer: vendorPosOrder
        ? { phone: guestCustomer?.phone || null }
        : undefined,
      locationId,
      deliveryTime: deliveryTime || null,
      deliveryDate: deliveryDate || null,
      fulfillmentType,
      deliveryAddress:
        fulfillmentType === 'DELIVERY' ? deliveryAddress || null : null,
      couponId,
      availabilityId,
      items: menuItems,
      locationData: loc || null,
      subTotal: subTotal,
      subtotal: subTotal,
      discount: disAmount,
      // totalAfterDiscount: subTotal + taxAmount - disAmount,
      totalAfterDiscount: subTotal - disAmount,
      taxAmount: normalizedTaxAmount,
      tax: normalizedTaxAmount,
      deliveryFee: normalizedDeliveryFee,
      tip: normalizedDriverTip,
      tips: normalizedDriverTip,
      tipsAmount: normalizedFoodTruckTip,
      paymentProcessingFee,
      totalOrderCost: total,
      total,
      avalaraTaxAmount: avalaraEstimate.result?.success
        ? normalizedTaxAmount
        : undefined,
      avalaraEstimateStatus: avalaraEstimate.result?.success
        ? 'SUCCESS'
        : 'FAILED',
      avalaraEstimateError: avalaraEstimate.result?.success
        ? null
        : {
            message:
              avalaraEstimate.result?.message || 'Avalara estimate failed',
          },
      avalaraEstimateResponse: avalaraEstimate.result?.data || null,
      freeDessertAmount,
      isFreeDessertEligible,
      freeDessertApplied: isFreeDessertEligible,
      orderStatus: initialOrderStatus,
      status: initialOrderStatus,
      orderNumber: counter.sequenceValue,
      paymentMethod: normalizedPaymentMethod,
      paymentStatus: normalizedPaymentStatus,
      transactionId,
      authCode,
      invoiceNumber,
      accountNumber,
      accountType,
      statusTime: buildInitialStatusTime(initialOrderStatus),
    });

    if (!vendorPosOrder && normalizedPaymentStatus === 'PAID') {
      try {
        const avalaraInvoice = await calculateAvalaraOrderTax({
          foodTruck,
          locationId,
          fulfillmentType,
          deliveryAddress,
          deliveryLat,
          deliveryLong,
          foodAmount: taxableFoodAmount,
          deliveryFee: normalizedDeliveryFee,
          serviceFee: paymentProcessingFee,
          type: 'SalesInvoice',
          commit: true,
          code: `RTC-ORDER-${data._id}`,
          customerCode: user?._id?.toString(),
          purchaseOrderNo: data.orderNumber
            ? `RTC-${data.orderNumber}`
            : undefined,
        });

        data.avalaraTransactionCode =
          avalaraInvoice.result?.payload?.code || null;
        data.avalaraTransactionId = avalaraInvoice.result?.data?.id || null;
        data.avalaraTaxAmount = avalaraInvoice.result?.success
          ? toMoney(avalaraInvoice.result.totalTax)
          : data.avalaraTaxAmount;
        data.avalaraCommitStatus = avalaraInvoice.result?.success
          ? 'SUCCESS'
          : 'FAILED';
        data.avalaraCommittedAt = avalaraInvoice.result?.success
          ? new Date()
          : null;
        data.avalaraError = avalaraInvoice.result?.success
          ? null
          : {
              message:
                avalaraInvoice.result?.message || 'Avalara invoice failed',
            };
        data.avalaraResponse = avalaraInvoice.result?.data || null;
        await data.save();
      } catch (err) {
        data.avalaraCommitStatus = 'FAILED';
        data.avalaraError = {
          message: err.message || 'Avalara invoice commit failed',
        };
        await data.save();
      }
    }

    if (couponId) {
      await CouponUsageService.create({ couponId, userId: user._id });
    }

    // UPDATE PAYMENT LOG AFTER ORDER CREATION (GATEWAY PAYMENTS ONLY)
    if (isGatewayPaymentMethod(normalizedPaymentMethod)) {
      try {
        const paymentLog = await PaymentsLogService.getByData(
          {
            transactionId: transactionId,
            userId: user._id,
            deletedAt: null,
          },
          { singleResult: true }
        );

        if (paymentLog) {
          paymentLog.orderId = data._id;
          paymentLog.orderPaymentStatus = 'PAID';

          await paymentLog.save();
        }
      } catch (err) {
        console.error('Payment log update failed:', err);
      }
    }

    try {
      if (!vendorPosOrder) {
        await CustomNotification.sendNewOrderNotification(
          { _id: foodTruck.userId },
          data._id
        );
      } else {
        await queueGuestSmsNotificationStub({ order: data, guestCustomer });
      }
    } catch (e) {}

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data },
      `${entityName} added`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.update = async (req, res, next) => {
  try {
    const {
      body: { orderStatus, pickupTime, cancelReason, paymentStatus },
      params: { id },
      user,
    } = req;

    const statusSort = {
      PLACED: 1,
      CANCEL: 2,
      REJECTED: 3,
      ACCEPTED: 4,
      PREPARING: 5,
      READY_FOR_PICKUP: 6,
      DRIVER_PICKED_UP: 7,
      DELIVERED: 8,
      COMPLETED: 9,
    };

    const statusTimeKey = {
      PLACED: 'placedAt',
      CANCEL: 'canceledAt',
      REJECTED: 'rejectedAt',
      ACCEPTED: 'acceptedAt',
      PREPARING: 'preparingAt',
      READY_FOR_PICKUP: 'readyAt',
      DRIVER_PICKED_UP: 'driverPickedUpAt',
      DELIVERED: 'deliveredAt',
      COMPLETED: 'completedAt',
    };

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No Order found'), 409);
    }
    const previousOrderStatus = item.orderStatus;
    if (['VENDOR', 'EMPLOYEE'].includes(user.userType)) {
      const foodTruck = await FoodTruckService.getByData(
        user.userType === 'EMPLOYEE'
          ? { _id: item.foodTruckId, userId: user.vendor_user_id }
          : { _id: item.foodTruckId, userId: user._id },
        { singleResult: true }
      );

      if (
        !foodTruck ||
        (user.userType === 'EMPLOYEE' &&
          item.locationId?.toString() !== user.assigned_location_id?.toString())
      ) {
        return res.error(new Error('Order not found or access denied'), 404);
      }
    }

    if (paymentStatus) {
      if (
        !(
          item.orderSource === 'VENDOR_POS' &&
          isCashPaymentMethod(item.paymentMethod) &&
          ['VENDOR', 'EMPLOYEE'].includes(user.userType)
        )
      ) {
        return res.error(
          new Error('Payment status can not be updated for this order'),
          409
        );
      }

      item.paymentStatus = paymentStatus;
    }

    if (user.userType === 'EMPLOYEE' && orderStatus) {
      const employeeAllowedStatuses = [
        'PREPARING',
        'READY_FOR_PICKUP',
        'COMPLETED',
      ];

      if (!employeeAllowedStatuses.includes(orderStatus)) {
        return res.error(
          new Error('Employees can only advance assigned POS orders'),
          403
        );
      }

      if (!WALK_UP_ORDER_SOURCES.includes(item.orderSource)) {
        return res.error(
          new Error('Employees can only update walk-up POS orders'),
          403
        );
      }

      await assertActiveEmployeeSession(user);
    }

    if (
      orderStatus &&
      orderStatus !== 'CANCEL' &&
      user.userType === 'CUSTOMER'
    ) {
      return res.error(
        new Error(`You can not update status to '${orderStatus}'`),
        409
      );
    }

    if (item.orderStatus === 'REJECTED') {
      return res.error(new Error(`This order is rejected by the vendor.`), 409);
    }

    if (orderStatus && statusSort[orderStatus] < statusSort[item.orderStatus]) {
      return res.error(
        new Error(
          `Can not update status to "${orderStatus}" while it is "${item.orderStatus}"`
        ),
        409
      );
    }

    if (orderStatus) {
      item.orderStatus = orderStatus;
      item.status = orderStatus;
      item.statusTime = item.statusTime || {
        placedAt: item.createdAt,
        canceledAt: null,
        acceptedAt: null,
        rejectedAt: null,
        preparingAt: null,
        readyAt: null,
        driverPickedUpAt: null,
        deliveredAt: null,
        completedAt: null,
      };

      if (item.orderStatus === 'CANCEL') {
        item.cancelReason = cancelReason;
      }

      if (orderStatus === 'PREPARING' && !item.statusTime.acceptedAt) {
        item.statusTime.acceptedAt = new Date().toISOString();
      }

      item.statusTime[statusTimeKey[orderStatus]] = new Date().toISOString();

      // Process refund for CANCEL/REJECTED orders with Apple Pay/Google Pay
      if (
        (orderStatus === 'CANCEL' || orderStatus === 'REJECTED') &&
        item.transactionId &&
        isGatewayPaymentMethod(item.paymentMethod)
      ) {
        try {
          const refundResp = await PaymentHelper.processRefund({
            transactionId: item.transactionId,
            amount: item.total,
          });

          // Log refund attempt if not skipLog
          if (!refundResp.skipLog) {
            await PaymentsLogService.create({
              userId: item.userId,
              orderId: item._id,
              type: 'REFUND',
              mode: refundResp.env,
              level: refundResp?.level || null,
              amount: Number(item.total),
              requestPayload: {
                orderId: item._id,
                transactionId: item.transactionId,
                amount: item.total,
                reason: orderStatus,
              },
              responsePayload: refundResp,
              transactionId: item.transactionId,
              uniqueId: refundResp?.refundTransactionId || null,
              authCode: refundResp?.authCode || null,
              response_type: refundResp.success
                ? refundResp?.mode === 'void'
                  ? 'VOID'
                  : 'REFUND'
                : 'REFUND',
              accountNumber: refundResp.accountNumber || null,
              accountType: refundResp.accountType || null,
              success: refundResp.success,
              errorCode: refundResp.success ? null : refundResp.code,
              errorMessage: refundResp.success ? null : refundResp.message,
            });
          }

          // Update order with refund details
          if (refundResp.success) {
            item.paymentStatus = 'REFUNDED';
            item.refundTransactionId = refundResp?.refundTransactionId;
            item.refundDateTime = new Date();
            item.refundStatus = 'SUCCESS';
            item.refundReason =
              orderStatus === 'CANCEL' ? 'Order cancelled' : 'Order rejected';
            item.refundMode = refundResp?.mode === 'void' ? 'VOID' : 'REFUND';

            // Update original payment log
            try {
              const paymentLog = await PaymentsLogService.getByData(
                {
                  transactionId: item.transactionId,
                  orderId: item._id,
                  type: 'CHECKOUT',
                  deletedAt: null,
                },
                { singleResult: true }
              );
              if (paymentLog) {
                paymentLog.orderPaymentStatus = 'REFUNDED';
                await paymentLog.save();
              }
            } catch (err) {
              console.error('Payment log update failed:', err);
            }
          } else {
            item.refundStatus = 'FAILED';
            item.refundErrorMessage = refundResp.message;
          }
        } catch (refundError) {
          item.refundStatus = 'FAILED';
          item.refundErrorMessage =
            refundError.message || 'Refund processing failed';
        }
      }
    }

    if (orderStatus === 'PREPARING' && pickupTime) {
      item.pickupTime = pickupTime;
    }

    // Update payment status to PAID for cash orders when completed
    if (
      orderStatus === 'COMPLETED' &&
      isCashPaymentMethod(item.paymentMethod)
    ) {
      item.paymentStatus = 'PAID';
    }

    if (orderStatus === 'COMPLETED' && !item.completed_at) {
      item.completed_at = new Date();
    }

    if (user.userType === 'EMPLOYEE' && (orderStatus || paymentStatus)) {
      await touchEmployeeSession(user);
    }

    if (
      orderStatus === 'ACCEPTED' &&
      previousOrderStatus !== 'ACCEPTED' &&
      shouldCreateShipdayDelivery(item)
    ) {
      const shipdayClaimed = await claimShipdayDeliveryCreation(item);
      if (shipdayClaimed) {
        item.shipdayCreationStartedAt = new Date();
        item.shipdayCreationStatus = 'PENDING';
        const foodTruck = await FoodTruckService.getById(item.foodTruckId);
        try {
          const shipdayResponse = await createShipdayDeliveryForAcceptedOrder(
            item,
            foodTruck
          );

          if (shipdayResponse) {
            item.shipdayOrderCreatedAt = new Date();
            item.shipdayCreationStatus = 'SUCCESS';
            item.shipdayResponse = shipdayResponse;
            item.shipdayError = null;
          }
        } catch (shipdayError) {
          item.shipdayCreationStatus = 'FAILED';
          item.shipdayError = {
            message: shipdayError.message || 'Shipday delivery creation failed',
            statusCode: shipdayError.statusCode || null,
            responseBody: shipdayError.responseBody || null,
            date: new Date().toISOString(),
          };
          console.error(
            'Shipday delivery creation failed after order acceptance',
            {
              orderId: item._id.toString(),
              orderNumber: item.orderNumber,
              statusCode: item.shipdayError.statusCode,
              responseBody: item.shipdayError.responseBody,
              message: item.shipdayError.message,
            }
          );
        }
      } else {
        console.log('Shipday delivery creation skipped for claimed order', {
          orderId: item._id.toString(),
          orderNumber: item.orderNumber,
        });
      }
    }

    if (
      orderStatus === 'READY_FOR_PICKUP' &&
      previousOrderStatus !== 'READY_FOR_PICKUP' &&
      shouldCreateShipdayDelivery(item)
    ) {
      try {
        const shipdayStatusResponse = await updateShipdayReadyForPickup(item);
        if (shipdayStatusResponse) {
          item.shipdayStatusResponse = {
            ...(item.shipdayStatusResponse || {}),
            readyForPickup: shipdayStatusResponse,
            readyForPickupAt: new Date().toISOString(),
          };
          item.shipdayStatusError = null;
        }
      } catch (shipdayStatusError) {
        item.shipdayStatusError = {
          action: 'READY_FOR_PICKUP',
          message:
            shipdayStatusError.message ||
            'Shipday ready for pickup update failed',
          statusCode: shipdayStatusError.statusCode || null,
          responseBody: shipdayStatusError.responseBody || null,
          date: new Date().toISOString(),
        };
        console.error('Shipday ready for pickup update failed', {
          orderId: item._id.toString(),
          orderNumber: item.orderNumber,
          statusCode: item.shipdayStatusError.statusCode,
          responseBody: item.shipdayStatusError.responseBody,
          message: item.shipdayStatusError.message,
        });
      }
    }

    await item.save();

    try {
      if (orderStatus) {
        if (orderStatus === 'CANCEL') {
          const ft = await FoodTruckService.getById(item.foodTruckId);
          if (ft) {
            await CustomNotification.sendOrderStatusNotification(
              { _id: ft.userId },
              id,
              orderStatus
            );
          }
        } else if (item.orderSource !== 'VENDOR_POS') {
          await CustomNotification.sendOrderStatusNotification(
            { _id: item.userId },
            id,
            orderStatus
          );
        }
      }
    } catch (e) {}

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

exports.shipdayUpdate = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!process.env.BACKEND_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'BACKEND_API_KEY is not configured',
      });
    }

    if (apiKey !== process.env.BACKEND_API_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      orderId,
      status,
      driverName = null,
      deliveryTime = null,
      eventId = null,
      rawPayload = null,
    } = req.body || {};

    console.log('Shipday update incoming payload:', req.body);

    if (!orderId || !status) {
      return res.status(400).json({
        success: false,
        message: 'orderId and status are required',
      });
    }

    const mappedStatus = SHIPDAY_STATUS_MAP[normalizeShipdayStatus(status)];
    console.log('Shipday update mapped status:', {
      orderId,
      status,
      mappedStatus,
    });

    if (!mappedStatus) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported Shipday status',
      });
    }

    const order = await OrderModel.findOne(
      getShipdayOrderFilter(orderId)
    ).lean();
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const existingEventIds =
      order.shipdayResponse?.processedEventIds ||
      order.shipdayResponse?.shipdayWebhookEvents ||
      [];
    const processedEventIds = Array.isArray(existingEventIds)
      ? existingEventIds
      : [];

    if (eventId && processedEventIds.includes(eventId)) {
      console.log('Shipday update duplicate event ignored:', {
        orderId,
        eventId,
      });
      return res.json({ success: true });
    }

    const statusSort = {
      PLACED: 1,
      ACCEPTED: 2,
      PREPARING: 3,
      READY_FOR_PICKUP: 4,
      DRIVER_PICKED_UP: 5,
      DELIVERED: 6,
      COMPLETED: 7,
      CANCEL: 8,
      REJECTED: 8,
    };

    if (
      statusSort[mappedStatus] &&
      statusSort[order.orderStatus] &&
      statusSort[mappedStatus] < statusSort[order.orderStatus]
    ) {
      console.log('Shipday update stale status ignored:', {
        orderId,
        currentStatus: order.orderStatus,
        mappedStatus,
      });
      return res.json({ success: true });
    }

    const now = new Date();
    const update = {
      orderStatus: mappedStatus,
      status: mappedStatus,
      driverName,
      deliveryTime,
      updatedAt: now,
      shipdayResponse: {
        ...(order.shipdayResponse || {}),
        latestWebhook: rawPayload,
        latestWebhookStatus: status,
        latestMappedStatus: mappedStatus,
        latestDriverName: driverName,
        latestDeliveryTime: deliveryTime,
        latestWebhookReceivedAt: now,
        processedEventIds: eventId
          ? [...processedEventIds, eventId]
          : processedEventIds,
      },
    };

    if (mappedStatus === 'READY_FOR_PICKUP') {
      update['statusTime.readyAt'] = order.statusTime?.readyAt || now;
    }

    if (mappedStatus === 'DRIVER_PICKED_UP') {
      update['statusTime.driverPickedUpAt'] =
        order.statusTime?.driverPickedUpAt || now;
    }

    if (mappedStatus === 'DELIVERED') {
      update['statusTime.deliveredAt'] = order.statusTime?.deliveredAt || now;
    }

    if (mappedStatus === 'COMPLETED') {
      update['statusTime.completedAt'] = order.statusTime?.completedAt || now;
    }

    const result = await OrderModel.collection.updateOne(
      { _id: order._id },
      { $set: update }
    );

    console.log('Shipday update DB result:', {
      orderId,
      eventId,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });

    if (result.modifiedCount && order.orderStatus !== mappedStatus) {
      try {
        await CustomNotification.sendOrderStatusNotification(
          { _id: order.userId },
          order._id,
          mappedStatus
        );
      } catch (notificationError) {
        console.error('Shipday status notification failed', {
          orderId,
          mappedStatus,
          message: notificationError.message,
        });
      }
    }

    return res.json({ success: true });
  } catch (e) {
    return next(e);
  }
};

exports.getVendorDashboard = async (req, res, next) => {
  try {
    const {
      query: { foodTruckId },
      user,
    } = req;

    if (!foodTruckId) {
      return res.error(new Error('Food truck ID is required'), 400);
    }

    // Verify user has access to this food truck
    const foodTruck = await FoodTruckService.getByData(
      { _id: foodTruckId, userId: user._id },
      { singleResult: true }
    );

    if (!foodTruck) {
      return res.error(new Error('Food truck not found or access denied'), 404);
    }

    const vendorHomeData = await Service.getVendorDashboardCountDetails(
      foodTruckId
    );

    return res.data(
      { vendorHomeData },
      'Vendor Home data retrieved successfully'
    );
  } catch (e) {
    return next(e);
  }
};
/**
 * Get vendor earnings with free dessert amounts
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.getVendorEarnings = async (req, res, next) => {
  try {
    const {
      query: {
        foodTruckId,
        startDate,
        endDate,
        locationId,
        employeeInternalId,
        paymentMethod,
        refundCancelStatus,
      },
      user,
    } = req;

    if (!foodTruckId) {
      return res.error(new Error('Food truck ID is required'), 400);
    }

    // Verify user has access to this food truck
    const foodTruck = await FoodTruckService.getByData(
      { _id: foodTruckId, userId: user._id },
      { singleResult: true }
    );

    if (!foodTruck) {
      return res.error(new Error('Food truck not found or access denied'), 404);
    }

    const earnings = await Service.getVendorEarningsWithFreeDessert(
      foodTruckId,
      startDate,
      endDate
    );
    const earningsFulldata = await Service.getVendorEarningsWithFreeDessertTest(
      foodTruckId
    );
    const employeeAnalytics =
      await EmployeeSessionService.getVendorEmployeeAnalytics({
        vendorUserId: user._id,
        foodTruck,
        startDate,
        endDate,
        locationId,
        employeeInternalId,
        paymentMethod,
        refundCancelStatus,
      });

    return res.data(
      { earnings, earningsFulldata, employeeAnalytics },
      'Vendor earnings retrieved successfully'
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * Get free dessert eligibility for the authenticated customer
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.getFreeDessertEligibility = async (req, res, next) => {
  try {
    const { user } = req;

    // Fetch global free dessert settings
    const settings = await SettingService.getByData({}, { singleResult: true });

    const isFeatureEnabled = !!settings?.isFreeDessertEnabled;
    const configuredAmount = Number(settings?.freeDessertAmount || 0);
    const thresholdOrderCount = Number(settings?.freeDessertOrderCount || 0);

    // If user already redeemed once, they are never eligible again
    // Count user's completed orders and applied redemptions (for recurring logic)
    const completedOrders = await Service.getCount({
      userId: user._id,
      orderStatus: { $in: ['DELIVERED', 'COMPLETED'] },
      deletedAt: null,
    });
    const priorRedemptionCount = await Service.getCount({
      userId: user._id,
      freeDessertApplied: true,
      deletedAt: null,
    });

    const nextOrderNumber = completedOrders + 1;
    const maxEligibleRedemptions = Math.floor(
      nextOrderNumber / Math.max(thresholdOrderCount, 1)
    );
    const isEligibleNow = Boolean(
      isFeatureEnabled &&
        configuredAmount > 0 &&
        thresholdOrderCount > 0 &&
        nextOrderNumber % thresholdOrderCount === 0 &&
        priorRedemptionCount < maxEligibleRedemptions
    );

    const ordersRemainingRaw = thresholdOrderCount - nextOrderNumber;
    const ordersRemaining = ordersRemainingRaw > 0 ? ordersRemainingRaw : 0;

    return res.data(
      {
        eligibility: {
          isFreeDessertEnabled: isFeatureEnabled,
          isEligibleNow,
          freeDessertAmount: isEligibleNow ? configuredAmount : 0,
          freeDessertOrderCount: thresholdOrderCount,
          userCompletedOrders: completedOrders,
          nextOrderNumber,
          ordersRemaining,
          alreadyRedeemed: priorRedemptionCount > 0,
        },
      },
      'Free dessert eligibility'
    );
  } catch (e) {
    return next(e);
  }
};

exports.getVendorEarningsList = async (req, res, next) => {
  try {
    const {
      query: {
        foodTruckId,
        limit = 10,
        page = 1,
        search = '',
        earning_list = 'daily',
        is_list = 'normal',
        startDate = null,
        endDate = null,
      },
      user,
    } = req;

    if (!foodTruckId) {
      return res.error(new Error('Food truck ID is required'), 400);
    }

    const foodTruck = await FoodTruckService.getByData(
      { _id: foodTruckId, userId: user._id },
      { singleResult: true }
    );

    if (!foodTruck) {
      return res.error(new Error('Food truck not found or access denied'), 404);
    }

    if (startDate && !endDate) {
      return res.error(
        new Error('endDate is required when startDate is provided'),
        404
      );
    }
    if (!startDate && endDate) {
      return res.error(
        new Error('startDate is required when endDate is provided'),
        404
      );
    }
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (end < start) {
        return res.error(
          new Error('endDate must be greater than or equal to startDate'),
          404
        );
      }
    }
    const {
      data,
      total,
      earning_total,
      totalFreeDessertAmount,
      totalFreeDessertCount,
      cashEarning,
      digitalEarning,
    } = await Service.getVendorEarningList(
      limit,
      page,
      user,
      search,
      foodTruckId,
      earning_list,
      is_list,
      startDate,
      endDate
    );
    return res.data(
      {
        data,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / limit),
        earnings_total: earning_total,
        cashEarning: cashEarning,
        digitalEarning: digitalEarning,
        totalFreeDessertAmount: totalFreeDessertAmount,
        totalFreeDessertCount: totalFreeDessertCount,
      },
      `${earning_list} earnings fetched successfully.`
    );
  } catch (e) {
    console.error('Error in getVendorEarningsList:', e);
    return next(e);
  }
};
