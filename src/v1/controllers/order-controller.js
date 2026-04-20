const {
  OrderService: Service,
  FoodTruckService,
  MenuItemService,
  CouponService,
  CouponUsageService,
  OrderCounterService,
  TaxRatesService,
  SettingService,
  PaymentsLogService,
} = require('../services');
const entityName = 'Order';
const mongoose = require('mongoose');
const CustomNotification = require('../../helper/custom-notification');
const PaymentHelper = require('../../helper/payment-helper');
const MailHelper = require('../../helper/mail-helper');

const { env } = require('../../config');
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
        tipsAmount=0,
        availabilityId,
      },
      user,
    } = req;

    const menuIds = {};
    const foodTruck = await FoodTruckService.getById(foodTruckId);
    if (!foodTruck) {
      return res.error(new Error('No food truck found'), 409);
    }

    if (availabilityId) {
      const avl = !!(foodTruck.availability || []).find(
        (itm) => itm._id.toString() === availabilityId
      );
      if (!avl) {
        return res.error(new Error('Availability mismatch'), 409);
      }
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
        console.log("item", item);
        console.log("item",menuIds[item.menuItemId]);
        if (menuIds[item.menuItemId]) {
          if (item.qty < menuIds[item.menuItemId].minQty) {
            throw `Minimum quantity must be ${menuIds[item.menuItemId].minQty
            } for the "${menuIds[item.menuItemId].name}"`;
          }
          if (item.qty > menuIds[item.menuItemId].maxQty) {
            throw `Maximum quantity must be ${menuIds[item.menuItemId].maxQty
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

          // Handle combo items
          let comboItemsWithDetails = [];
          let comboSubtotal = 0;
          if (itemType === 'COMBO' && item.comboItems && item.comboItems.length > 0) {
            item.comboItems.forEach((comboItem) => {
              const subItemMatch = subItemarray.find(sub => sub._id.toString() === comboItem.comboMenuItemId);
              if (subItemMatch) {
                const comboQty = comboItem.qty || 1;
                // const comboTotal = subItemMatch.price * comboQty;
                const comboTotal = 0;

                comboSubtotal += comboTotal;
                comboItemsWithDetails.push({
                  ...subItemMatch,
                  qty: comboQty,
                  total: comboTotal
                });
              }
            });
          }


          // Clone original data (so we don't mutate the original menu item)
          let updatedFullMenuItemData = { ...menuIds[item.menuItemId] };
          const mainSubtotal = price * item.qty;
          let itemTotal = mainSubtotal;
          
          const discountRules = menuIds[item.menuItemId].discountRules;
          
          // Add combo items to fullMenuItemData
          if (itemType === 'COMBO' && comboItemsWithDetails.length > 0) {
            updatedFullMenuItemData.comboItems = comboItemsWithDetails;
          }
          
          if (discountRules && discountRules.discount > 0) {
            const { buyQty = 1, getQty = 1, discount: discountVal = 0, repeatable = true } = discountRules;
            
            const eligibleSets = repeatable 
              ? Math.floor(item.qty / buyQty) 
              : (item.qty >= buyQty ? 1 : 0);
              
            const rewardItems = eligibleSets * getQty;
            const rewardTotal = rewardItems * price;
            const discountAmount = rewardTotal * discountVal;
            
            itemTotal = mainSubtotal + rewardTotal - discountAmount;

            // Update bogoItems in updatedFullMenuItemData for front-end display
            updatedFullMenuItemData.bogoItems = [{
              itemId: item.menuItemId,
              name: name,
              price: price,
              qty: rewardItems,
              isSameItem: true,
              discountVal: discountVal
            }];
          } else {
            // Fallback to old logic if no discountRules
            // ✅ Only replace bogoItems if discount type is "bogo"
            if (discountType && discountType === 'BOGO') {
              updatedFullMenuItemData = {
                ...updatedFullMenuItemData,
                bogoItems: Array.isArray(bogoItemsatrray)
                  ? bogoItemsatrray.map((bogo) => ({
                    ...bogo,
                    qty: item.qty, // update quantity same as parent
                  }))
                  : [],
              };
            }
            // ---------- BOGOHO Discount (Buy One Get One Half Off) ----------
            if (discountType && discountType === 'BOGOHO') {
              updatedFullMenuItemData = {
                ...updatedFullMenuItemData,
                bogoItems: Array.isArray(bogoItemsatrray)
                  ? bogoItemsatrray.map((bogo) => {
                    const halfPrice = bogo.price / 2;
                    // const bogoTotal = halfPrice * item.qty;
                    const bogoTotal = 0;
                    // Add BOGOHO price to subtotal
                    // bogohoSubtotal += bogoTotal;

                    return {
                      ...bogo,
                      qty: item.qty,
                      halfPrice,
                      total: bogoTotal,
                    };
                  })
                  : [],
              };
            }

            if (discountType === 'BOGOHO') {
              itemTotal = mainSubtotal * 1.5;
            } else {
              itemTotal = mainSubtotal;
            }
          }

          menuItems.push({
            menuItemId: item.menuItemId,
            customization: item.customization || null,
            price: price,
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

      disAmount = +Number((coupon.value * subTotal) / 100).toFixed(2);
    }

    let total = subTotal + taxAmount + tipsAmount - disAmount;
    let paymentProcessingFee = 0;
    const loc = foodTruck.locations.find(
      (itm) => itm.zipcode && itm._id.toString() === locationId
    );
    if (loc) {
      const tax = await TaxRatesService.getByData(
        { zip: loc.zipcode },
        { singleResult: true }
      );

      // taxAmount = ((tax?.estimatedCombineRate || 0) * total) / 100;
      // total += taxAmount || 0 ;

      paymentProcessingFee = (3.5 * total) / 100;
      total += paymentProcessingFee;
    }

    // const counter = await OrderCounterService.updateTheCounter(foodTruck?._id);

    // Check for free dessert eligibility (one-time per user)
    let freeDessertAmount = 0;
    let isFreeDessertEligible = false;

    const settings = await SettingService.getByData({}, { singleResult: true });
    if (
      settings?.isFreeDessertEnabled &&
      settings?.freeDessertAmount > 0 &&
      settings?.freeDessertOrderCount > 0
    ) {
      // Count user's completed orders and prior redemptions
      const completedOrders = await Service.getCount({
        userId: user._id,
        orderStatus: 'COMPLETED',
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
      userId: user._id,
      locationId,
      deliveryTime: deliveryTime || null,
      deliveryDate: deliveryDate || null,
      couponId,
      availabilityId,
      items: menuItems,
      subTotal: subTotal,
      discount: disAmount,
            // totalAfterDiscount: subTotal + taxAmount - disAmount,
      totalAfterDiscount: subTotal - disAmount,
      taxAmount,
      tipsAmount,
      paymentProcessingFee,
      total,
      freeDessertAmount,
      isFreeDessertEligible,
      freeDessertApplied: isFreeDessertEligible,
      orderStatus: 'PLACED',
      statusTime: {
        placedAt: new Date().toISOString(),
        canceledAt: null,
        acceptedAt: null,
        rejectedAt: null,
        preparingAt: null,
        readyAt: null,
        completedAt: null,
      },
    };
    console.log("orderPlaceData",orderPlaceData);
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

    console.log('paymentData', paymentData);

    const base64String = Buffer.from(paymentMethod === 'APPLE_PAY' ? JSON.stringify(paymentData) : paymentData).toString(
      'base64'
    );

    console.log('base64String', base64String);

    const userId = user._id;
    const email = user.email;
    const firstName = user.firstName;
    const lastName = user.lastName;

    // const opaqueToken = applePayToken || googlePayToken;
    const opaqueToken = base64String;
    // console.log(typeof(base64String));
    // console.log("applePayToken",typeof(applePayToken));

    if (!opaqueToken) {
      return res.error(new Error('ApplePay or GooglePay token missing'), 400);
    }
    //  CHARGE PAYMENT
    const chargeResp = await PaymentHelper.chargePaymentUnified({
      opaqueToken,
      amount,
      paymentMethod,
      firstName,
      lastName,
      email,
      taxAmount,
      subTotal,
      userId,
    });

    console.log('chargeResp =>', chargeResp);

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
      } catch (e) { }

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
    } catch (e) { }

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
    const {
      orderId,
      transactionId,
      amount,
    } = req.body;

    const entityName = 'Order';

    if (!orderId || !transactionId || !amount) {
      return res.error(new Error('orderId, transactionId and amount required'), 400);
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
        uniqueId: resp?.refundTransactionId || resp?.fullResponse?.transId || null,
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
      order.refundTransactionId = resp?.refundTransactionId || resp?.fullResponse?.transId || null;
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
        tipsAmount=0,
        availabilityId,
      },
      user,
    } = req;

    const menuIds = {};
    const foodTruck = await FoodTruckService.getById(foodTruckId);
    if (!foodTruck) {
      return res.error(new Error('No food truck found'), 409);
    }

    if (availabilityId) {
      const avl = !!(foodTruck.availability || []).find(
        (itm) => itm._id.toString() === availabilityId
      );
      if (!avl) {
        return res.error(new Error('Availability mismatch'), 409);
      }
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
            throw `Minimum quantity must be ${menuIds[item.menuItemId].minQty
            } for the "${menuIds[item.menuItemId].name}"`;
          }
          if (item.qty > menuIds[item.menuItemId].maxQty) {
            throw `Maximum quantity must be ${menuIds[item.menuItemId].maxQty
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

          // Handle combo items
          let comboItemsWithDetails = [];
          let comboSubtotal = 0;
          if (itemType === 'COMBO' && item.comboItems && item.comboItems.length > 0) {
            item.comboItems.forEach((comboItem) => {
              const subItemMatch = subItemarray.find(sub => sub._id.toString() === comboItem.comboMenuItemId);
              if (subItemMatch) {
                const comboQty = comboItem.qty || 1;
                // const comboTotal = subItemMatch.price * comboQty;
                  const comboTotal = 0;

                comboSubtotal += comboTotal;
                comboItemsWithDetails.push({
                  ...subItemMatch,
                  qty: comboQty,
                  total: comboTotal
                });
              }
            });
          }


          // Clone original data (so we don't mutate the original menu item)
          let updatedFullMenuItemData = { ...menuIds[item.menuItemId] };
          const mainSubtotal = price * item.qty;
          let bogohoSubtotal = 0;
          
          // Add combo items to fullMenuItemData
          if (itemType === 'COMBO' && comboItemsWithDetails.length > 0) {
            updatedFullMenuItemData.comboItems = comboItemsWithDetails;
          }
          
          // ✅ Only replace bogoItems if discount type is "bogo"
          if (discountType && discountType === 'BOGO') {
            updatedFullMenuItemData = {
              ...updatedFullMenuItemData,
              bogoItems: Array.isArray(bogoItemsatrray)
                ? bogoItemsatrray.map((bogo) => ({
                  ...bogo,
                  qty: item.qty, // update quantity same as parent
                }))
                : [],
            };
          }

          // ---------- BOGOHO Discount (Buy One Get One Half Off) ----------
          if (discountType && discountType === 'BOGOHO') {
            updatedFullMenuItemData = {
              ...updatedFullMenuItemData,
              bogoItems: Array.isArray(bogoItemsatrray)
                ? bogoItemsatrray.map((bogo) => {
                  const halfPrice = bogo.price / 2;
                  // const bogoTotal = halfPrice * item.qty;
                  const bogoTotal = 0;

                  // Add BOGOHO price to subtotal
                  bogohoSubtotal += bogoTotal;

                  return {
                    ...bogo,
                    qty: item.qty,
                    halfPrice,
                    total: bogoTotal,
                  };
                })
                : [],
            };
          }

          menuItems.push({
            menuItemId: item.menuItemId,
            customization: item.customization || null,
            price: price,
            name: name,
            imgUrls: imgUrls,
            description: description,
            qty: item.qty,
            discountType:discountType||null,
            comboItems: comboItemsWithDetails,
            comboSubtotal:comboSubtotal,
            fullMenuItemData: updatedFullMenuItemData,
            total: mainSubtotal,
          });

          if (discountType === 'BOGOHO') {
            // subTotal += mainSubtotal + bogohoSubtotal;
            const addhalf= mainSubtotal * 1.5;
            subTotal += addhalf;
          } else {
            subTotal += mainSubtotal;
          }
          
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

      disAmount = +Number((coupon.value * subTotal) / 100).toFixed(2);
    }

    let total = subTotal + taxAmount + tipsAmount - disAmount;
    let paymentProcessingFee = 0;
    const loc = foodTruck.locations.find(
      (itm) => itm.zipcode && itm._id.toString() === locationId
    );
    if (loc) {
      const tax = await TaxRatesService.getByData(
        { zip: loc.zipcode },
        { singleResult: true }
      );

      // taxAmount = ((tax?.estimatedCombineRate || 0) * total) / 100;
      // total += taxAmount || 0 ;

      paymentProcessingFee = (3.5 * total) / 100;
      total += paymentProcessingFee;
    }

    const counter = await OrderCounterService.updateTheCounter(foodTruck?._id);

    // Check for free dessert eligibility (one-time per user)
    let freeDessertAmount = 0;
    let isFreeDessertEligible = false;

    const settings = await SettingService.getByData({}, { singleResult: true });
    if (
      settings?.isFreeDessertEnabled &&
      settings?.freeDessertAmount > 0 &&
      settings?.freeDessertOrderCount > 0
    ) {
      // Count user's completed orders and prior redemptions
      const completedOrders = await Service.getCount({
        userId: user._id,
        orderStatus: 'COMPLETED',
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
      userId: user._id,
      locationId,
      deliveryTime: deliveryTime || null,
      deliveryDate: deliveryDate || null,
      couponId,
      availabilityId,
      items: menuItems,
      locationData: loc || null,
      subTotal: subTotal,
      discount: disAmount,
      // totalAfterDiscount: subTotal + taxAmount - disAmount,
      totalAfterDiscount: subTotal - disAmount,
      taxAmount,
      tipsAmount,
      paymentProcessingFee,
      total,
      freeDessertAmount,
      isFreeDessertEligible,
      freeDessertApplied: isFreeDessertEligible,
      orderStatus: 'PLACED',
      orderNumber: counter.sequenceValue,
      paymentMethod,
      paymentStatus,
      transactionId,
      authCode,
      invoiceNumber,
      accountNumber,
      accountType,
      statusTime: {
        placedAt: new Date().toISOString(),
        canceledAt: null,
        acceptedAt: null,
        rejectedAt: null,
        preparingAt: null,
        readyAt: null,
        completedAt: null,
      },
    });

    if (couponId) {
      await CouponUsageService.create({ couponId, userId: user._id });
    }

    // UPDATE PAYMENT LOG AFTER ORDER CREATION (NON-COD)
    if (paymentMethod !== 'COD') {
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
      await CustomNotification.sendNewOrderNotification(
        { _id: foodTruck.userId },
        data._id
      );
    } catch (e) { }

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
      body: { orderStatus, pickupTime, cancelReason },
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
      COMPLETED: 7,
    };

    const statusTimeKey = {
      PLACED: 'placedAt',
      CANCEL: 'canceledAt',
      REJECTED: 'rejectedAt',
      ACCEPTED: 'acceptedAt',
      PREPARING: 'preparingAt',
      READY_FOR_PICKUP: 'readyAt',
      COMPLETED: 'completedAt',
    };

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No Order found'), 409);
    }

    if (orderStatus !== 'CANCEL' && user.userType === 'CUSTOMER') {
      return res.error(
        new Error(`You can not update status to '${orderStatus}'`),
        409
      );
    }

    if (item.orderStatus === 'REJECTED') {
      return res.error(new Error(`This order is rejected by the vendor.`), 409);
    }

    if (statusSort[orderStatus] < statusSort[item.orderStatus]) {
      return res.error(
        new Error(
          `Can not update status to "${orderStatus}" while it is "${item.orderStatus}"`
        ),
        409
      );
    }

    if (orderStatus) {
      item.orderStatus = orderStatus;
      item.statusTime = item.statusTime || {
        placedAt: item.createdAt,
        canceledAt: null,
        acceptedAt: null,
        rejectedAt: null,
        preparingAt: null,
        readyAt: null,
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
      if ((orderStatus === 'CANCEL' || orderStatus === 'REJECTED') &&
        item.transactionId &&
        (item.paymentMethod === 'APPLE_PAY' || item.paymentMethod === 'GOOGLE_PAY')) {

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
              requestPayload: { orderId: item._id, transactionId: item.transactionId, amount: item.total, reason: orderStatus },
              responsePayload: refundResp,
              transactionId: item.transactionId,
              uniqueId: refundResp?.refundTransactionId || null,
              authCode: refundResp?.authCode || null,
              response_type: refundResp.success ? (refundResp?.mode === 'void' ? 'VOID' : 'REFUND') : 'REFUND',
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
            item.refundReason = orderStatus === 'CANCEL' ? 'Order cancelled' : 'Order rejected';
            item.refundMode = refundResp?.mode === 'void' ? 'VOID' : 'REFUND';

            // Update original payment log
            try {
              const paymentLog = await PaymentsLogService.getByData(
                { transactionId: item.transactionId, orderId: item._id, type: 'CHECKOUT', deletedAt: null },
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
          item.refundErrorMessage = refundError.message || 'Refund processing failed';
        }
      }
    }

    if (orderStatus === 'PREPARING' && pickupTime) {
      item.pickupTime = pickupTime;
    }

    // Update payment status to PAID for COD orders when completed
    if (orderStatus === 'COMPLETED' && item.paymentMethod === 'COD') {
      item.paymentStatus = 'PAID';
    }

    await item.save();

    try {
      if (orderStatus === 'CANCEL') {
        const ft = await FoodTruckService.getById(item.foodTruckId);
        if (ft) {
          await CustomNotification.sendOrderStatusNotification(
            { _id: ft.userId },
            id,
            orderStatus
          );
        }
      } else {
        await CustomNotification.sendOrderStatusNotification(
          { _id: item.userId },
          id,
          orderStatus
        );
      }
    } catch (e) { }

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} updated`
    );
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
      query: { foodTruckId, startDate, endDate },
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

    return res.data(
      { earnings, earningsFulldata },
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
      orderStatus: 'COMPLETED',
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
