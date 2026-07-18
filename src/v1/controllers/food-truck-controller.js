const {
  FoodTruckService: Service,
  MenuItemService,
  FavoriteFoodTruckService,
  UserService,
  UserRestictDietService,
  BankDetailService,
  PlanService,
  EmployeeSessionService,
  MarketplaceEventService,
  MarketplaceEventImageService,
} = require('../services');
const { Joi } = require('express-validation');
const MailHelper = require('../../helper/mail-helper');
const Utils = require('../../helper/utils');
const {
  assertNewDishHighlightAllowed,
  assertSocialMediaLinksAllowed,
  canUseMultipleTruckUnits,
  normalizeVendorPlan,
} = require('../../helper/vendor-plan-helper');
const VendorComplianceService = require('../services/vendor-compliance-service');
const { addObjectWithKey, removeObject } = require('../../helper/aws');
const fs = require('fs');
const entityName = 'FoodTruck';

const toNumberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseCsvParam = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const DOCUMENT_TYPES = new Set(['PERMIT', 'LICENSE', 'INSURANCE', 'EIN', 'W9', 'OTHER']);

const normalizeDocumentType = (value) => {
  const normalized = String(value || 'OTHER')
    .trim()
    .toUpperCase();
  return DOCUMENT_TYPES.has(normalized) ? normalized : 'OTHER';
};

const normalizeDocumentName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeFilterValue = (value) => String(value || '').trim().toLowerCase();

const matchesFoodCuisineFilters = (item, cuisineIds = [], cuisines = []) => {
  if (!cuisineIds.length && !cuisines.length) return true;

  const selectedIds = cuisineIds.map(normalizeFilterValue);
  const selectedNames = cuisines.map(normalizeFilterValue);
  const truckCuisines = item.raw?.cuisine || [];

  return truckCuisines.some((cuisine) => {
    const id = normalizeFilterValue(cuisine?._id);
    const name = normalizeFilterValue(cuisine?.name);

    return (
      (id && selectedIds.includes(id)) ||
      (name && selectedNames.includes(name))
    );
  });
};

const matchesEventTypeFilters = (event, eventTypes = []) => {
  if (!eventTypes.length) return true;
  const selectedTypes = eventTypes.map(normalizeFilterValue);
  return selectedTypes.includes(normalizeFilterValue(event.event_type));
};

const getMarketplaceEventAddress = (event) =>
  event.formatted_address ||
  event.geocoded_address ||
  [event.event_address, event.event_city, event.event_state, event.event_zip]
    .filter(Boolean)
    .join(', ');

const getFirstImageUrl = (images = []) => images.find(Boolean)?.image_url || null;

const getFoodPreview = (truck, matchedMenuItem) =>
  matchedMenuItem?.description ||
  matchedMenuItem?.name ||
  truck.cuisine?.map((item) => item.name).filter(Boolean).join(', ') ||
  truck.name;

const getOpenTruckLocationCandidates = (truck, userLat, userLong) => {
  if (userLat === null || userLong === null) {
    return [];
  }

  const locationById = (truck.locations || []).reduce((acc, location) => {
    if (location?._id) {
      acc[location._id.toString()] = location;
    }
    return acc;
  }, {});

  const candidates = [];
  (truck.truck_units || []).forEach((unit) => {
    if (unit.is_archived) return;
    (unit.open_locations || []).forEach((openLocation) => {
      if (!openLocation?.isOrderingOpen) return;
      const locationId =
        openLocation.locationId?.toString() ||
        openLocation.location_id?.toString() ||
        openLocation._id?.toString();
      const location = locationById[locationId];
      const latitude = toNumberOrNull(location?.lat);
      const longitude = toNumberOrNull(location?.long);
      if (latitude === null || longitude === null) return;
      candidates.push({
        location,
        truck_unit_id: unit._id,
        truck_unit_name: unit.name,
        distanceInMeters: Utils.getDistanceInMeters(
          userLat,
          userLong,
          latitude,
          longitude
        ),
      });
    });
  });

  return candidates.sort((a, b) => a.distanceInMeters - b.distanceInMeters);
};

const getClosestOpenTruckLocation = (truck, userLat, userLong) => {
  return getOpenTruckLocationCandidates(truck, userLat, userLong)[0] || null;
};

const normalizeNearMeFood = (
  truck,
  userLat = null,
  userLong = null,
  openLocationCandidate = undefined
) => {
  const matchedMenuItem = truck.matchedMenuItems?.[0] || truck.menu?.[0] || null;
  const imageUrl =
    matchedMenuItem?.imgUrls?.[0] || truck.logo || truck.photos?.[0] || null;
  const closestOpenLocation =
    openLocationCandidate === undefined
      ? getClosestOpenTruckLocation(truck, userLat, userLong)
      : openLocationCandidate;
  const location = closestOpenLocation?.location || truck.location || null;
  const vendorUser = Array.isArray(truck.user) ? truck.user[0] : truck.user;
  const mailingAddress = [
    vendorUser?.addressCity && vendorUser.addressCity !== 'NA'
      ? vendorUser.addressCity
      : null,
    vendorUser?.addressState && vendorUser.addressState !== 'NA'
      ? vendorUser.addressState
      : null,
    vendorUser?.addressPostal && vendorUser.addressPostal !== 'NA'
      ? vendorUser.addressPostal
      : null,
  ]
    .filter(Boolean)
    .join(', ');
  const distanceInMeters =
    closestOpenLocation?.distanceInMeters ?? truck.distanceInMeters ?? null;
  const locationId = location?._id?.toString() || truck.currentLocation || '';
  const truckUnitName = closestOpenLocation?.truck_unit_name || null;
  const displayName = truckUnitName || truck.name;
  const locationSource =
    closestOpenLocation
      ? 'OPEN_TRUCK_UNIT'
      : location
        ? truck.locationSource || 'SAVED_LOCATION'
        : 'MAILING_ADDRESS';

  return {
    type: 'FOOD',
    marker_type: 'TRUCK',
    id: [
      matchedMenuItem?._id?.toString() || truck._id?.toString(),
      locationId,
      closestOpenLocation?.truck_unit_id?.toString() || '',
    ]
      .filter(Boolean)
      .join('-'),
    food_truck_id: truck._id,
    menu_item_id: matchedMenuItem?._id || null,
    truck_unit_id: closestOpenLocation?.truck_unit_id || null,
    truck_unit_name: truckUnitName,
    title: displayName,
    name: displayName,
    food_truck_name: truck.name,
    menu_item_name: matchedMenuItem?.name || null,
    description: getFoodPreview(truck, matchedMenuItem),
    preview: getFoodPreview(truck, matchedMenuItem),
    location,
    address: location?.address || location?.title || mailingAddress || '',
    latitude: toNumberOrNull(location?.lat),
    longitude: toNumberOrNull(location?.long),
    location_source: locationSource,
    location_label:
      locationSource === 'MAILING_ADDRESS'
        ? 'Mailing address'
        : locationSource === 'SAVED_LOCATION'
          ? 'Saved location'
          : 'Open location',
    image_url: imageUrl,
    distance: distanceInMeters,
    distanceInMeters,
    raw: truck,
  };
};

const normalizeNearMeEvent = (event, imagesByEventId, userLat, userLong) => {
  const latitude = toNumberOrNull(event.latitude);
  const longitude = toNumberOrNull(event.longitude);
  const hasCoordinates = latitude !== null && longitude !== null;
  const distance =
    hasCoordinates && userLat !== null && userLong !== null
      ? Utils.getDistanceInMeters(userLat, userLong, latitude, longitude)
      : null;

  return {
    type: 'EVENT',
    marker_type: 'TENT',
    id: event.event_id,
    event_id: event.event_id,
    title: event.event_name,
    name: event.event_name,
    description: event.event_description || event.event_type || '',
    preview: event.event_description || event.event_type || '',
    event_type: event.event_type,
    event_date: event.event_date,
    event_time: event.event_time,
    location: getMarketplaceEventAddress(event),
    address: getMarketplaceEventAddress(event),
    event_city: event.event_city,
    event_state: event.event_state,
    event_zip: event.event_zip,
    latitude,
    longitude,
    image_url: getFirstImageUrl(imagesByEventId[event.event_id] || []),
    distance,
    distanceInMeters: distance,
    raw: event,
  };
};

const matchesEventSearch = (event, search) => {
  const query = search?.trim().toLowerCase();
  if (!query) return true;

  const words = query.split(/\s+/).filter(Boolean);
  const haystack = [
    event.event_name,
    event.event_description,
    event.event_type,
    event.event_address,
    event.event_city,
    event.event_state,
    event.event_zip,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query) || words.some((word) => haystack.includes(word));
};

const normalizeLocations = (incomingLocations, existingLocations = []) => {
  const existingById = {};
  (existingLocations || []).forEach((loc) => {
    if (loc?._id) {
      existingById[loc._id.toString()] = loc;
    }
  });

  return (incomingLocations || []).map((loc) => {
    const previous = loc?._id ? existingById[loc._id.toString()] : null;
    return {
      ...loc,
      isOrderingOpen:
        loc.isOrderingOpen !== undefined
          ? loc.isOrderingOpen
          : previous?.isOrderingOpen || false,
    };
  });
};

const asPlain = (value) =>
  typeof value?.toObject === 'function' ? value.toObject() : value;

const getTruckUnitId = (unit) => unit?._id?.toString();
const toPhoneDigits = (value) =>
  value === null || value === undefined ? '' : String(value).replace(/\D/g, '');

const ensureDefaultTruckUnits = (foodTruck) => {
  if (!foodTruck) return [];

  const units = foodTruck.truck_units || [];
  if (!units.length) {
    foodTruck.truck_units = [
      {
        name: foodTruck.name || 'Truck 1',
        phone: null,
        display_order: 1,
        is_primary: true,
        is_archived: false,
        archived_at: null,
        open_locations: [],
      },
    ];
  } else {
    let primaryFound = false;
    foodTruck.truck_units = units.map((unit, index) => {
      const plainUnit = asPlain(unit);
      const isPrimary = plainUnit.is_primary || (!primaryFound && index === 0);
      if (isPrimary) primaryFound = true;
      return {
        ...plainUnit,
        name: isPrimary ? foodTruck.name || plainUnit.name || 'Truck 1' : plainUnit.name,
        phone: isPrimary ? plainUnit.phone || null : plainUnit.phone || null,
        display_order: plainUnit.display_order || index + 1,
        is_primary: isPrimary,
        is_archived: !!plainUnit.is_archived,
        archived_at: plainUnit.archived_at || null,
        open_locations: plainUnit.open_locations || [],
      };
    });
  }

  const activeCount = (foodTruck.truck_units || []).filter(
    (unit) => !unit.is_archived
  ).length;
  foodTruck.food_truck_count = Math.max(activeCount || 1, 1);
  return foodTruck.truck_units;
};

const hasTruckUnitOpenState = (foodTruck) =>
  (foodTruck.truck_units || []).some((unit) =>
    (unit.open_locations || []).some((loc) => loc.isOrderingOpen)
  );

const syncOrderingLocationFlagsFromTruckUnits = (foodTruck) => {
  const openLocationIds = new Set();
  (foodTruck.truck_units || []).forEach((unit) => {
    if (unit.is_archived) return;
    (unit.open_locations || []).forEach((loc) => {
      if (loc.isOrderingOpen && loc.locationId) {
        openLocationIds.add(loc.locationId.toString());
      }
    });
  });

  foodTruck.locations = (foodTruck.locations || []).map((loc) => {
    loc.isOrderingOpen = openLocationIds.has(loc._id?.toString());
    return loc;
  });

  foodTruck.currentLocation = openLocationIds.values().next().value || null;
};

const getPrimaryTruckUnit = (foodTruck) => {
  ensureDefaultTruckUnits(foodTruck);
  return (
    (foodTruck.truck_units || []).find((unit) => unit.is_primary) ||
    (foodTruck.truck_units || [])[0]
  );
};

const findTruckUnit = (foodTruck, truckUnitId) => {
  ensureDefaultTruckUnits(foodTruck);
  const normalizedTruckUnitId =
    truckUnitId || getTruckUnitId(getPrimaryTruckUnit(foodTruck));
  return (foodTruck.truck_units || []).find(
    (unit) => getTruckUnitId(unit) === normalizedTruckUnitId?.toString()
  );
};

const setTruckUnitLocationOpen = ({
  foodTruck,
  truckUnitId,
  locationId,
  isOpen,
  closeOtherLocations = false,
}) => {
  const unit = findTruckUnit(foodTruck, truckUnitId);
  if (!unit || unit.is_archived) {
    const error = new Error('Truck name not found or archived');
    error.code = 404;
    throw error;
  }

  if (isOpen && !closeOtherLocations) {
    const existingOpenLocation = (unit.open_locations || []).find(
      (loc) =>
        loc.isOrderingOpen &&
        loc.locationId?.toString() !== locationId?.toString()
    );

    if (existingOpenLocation) {
      const error = new Error(
        'Please close this truck at its current location before opening a new one'
      );
      error.code = 409;
      throw error;
    }
  }

  unit.open_locations = (unit.open_locations || []).filter((loc) => {
    if (loc.locationId?.toString() === locationId?.toString()) {
      return false;
    }

    return !(closeOtherLocations && loc.isOrderingOpen);
  });
  unit.open_locations.push({
    locationId,
    isOrderingOpen: !!isOpen,
    updated_at: new Date(),
  });

  syncOrderingLocationFlagsFromTruckUnits(foodTruck);
  foodTruck.markModified('truck_units');
  foodTruck.markModified('locations');
  foodTruck.markModified('currentLocation');
  return unit;
};

const getActiveTruckUnits = (foodTruck) => {
  ensureDefaultTruckUnits(foodTruck);
  return (foodTruck.truck_units || []).filter((unit) => !unit.is_archived);
};

const getArchivedTruckUnits = (foodTruck) => {
  ensureDefaultTruckUnits(foodTruck);
  return (foodTruck.truck_units || []).filter((unit) => unit.is_archived);
};

const archiveExtraTruckUnits = (foodTruck, targetCount) => {
  const activeUnits = getActiveTruckUnits(foodTruck).sort(
    (a, b) => (a.display_order || 0) - (b.display_order || 0)
  );
  activeUnits.slice(targetCount).forEach((unit) => {
    if (unit.is_primary) return;
    unit.is_archived = true;
    unit.archived_at = new Date();
    unit.open_locations = [];
  });
  foodTruck.food_truck_count = Math.max(targetCount, 1);
  syncOrderingLocationFlagsFromTruckUnits(foodTruck);
};

const createTruckUnit = (foodTruck, name, phone = null) => {
  ensureDefaultTruckUnits(foodTruck);
  const nextOrder =
    Math.max(0, ...(foodTruck.truck_units || []).map((unit) => unit.display_order || 0)) +
    1;
  foodTruck.truck_units.push({
    name,
    phone,
    display_order: nextOrder,
    is_primary: false,
    is_archived: false,
    archived_at: null,
    open_locations: [],
  });
  foodTruck.food_truck_count = getActiveTruckUnits(foodTruck).length;
  return foodTruck.truck_units[foodTruck.truck_units.length - 1];
};

const reactivateTruckUnit = (foodTruck, truckUnitId) => {
  const unit = (foodTruck.truck_units || []).find(
    (item) => getTruckUnitId(item) === truckUnitId?.toString()
  );
  if (!unit || !unit.is_archived || unit.is_primary) {
    const error = new Error('Archived truck name not found');
    error.code = 404;
    throw error;
  }
  unit.is_archived = false;
  unit.archived_at = null;
  foodTruck.food_truck_count = getActiveTruckUnits(foodTruck).length;
  return unit;
};

const syncOrderingLocationFlags = (foodTruck) => {
  ensureDefaultTruckUnits(foodTruck);
  if (hasTruckUnitOpenState(foodTruck)) {
    syncOrderingLocationFlagsFromTruckUnits(foodTruck);
    return;
  }

  const currentLocation = foodTruck.currentLocation?.toString() || null;
  const hasCurrentLocation =
    !!currentLocation &&
    (foodTruck.locations || []).some(
      (loc) => loc._id?.toString() === currentLocation
    );

  if (!hasCurrentLocation) {
    foodTruck.currentLocation = null;
  }

  foodTruck.locations = (foodTruck.locations || []).map((loc) => {
    loc.isOrderingOpen =
      !!foodTruck.currentLocation &&
      loc._id?.toString() === foodTruck.currentLocation.toString();
    return loc;
  });
};

const normalizeAvailabilityForCompare = (availability = []) =>
  JSON.stringify(
    (availability || []).map((slot) => ({
      day: slot.day || null,
      locationId: slot.locationId || null,
      truckUnitId: slot.truckUnitId || null,
      startTime: slot.startTime || null,
      endTime: slot.endTime || null,
      available: slot.available !== false,
    }))
  );

const cloneAvailability = (availability = []) =>
  JSON.parse(JSON.stringify(availability || []));

const getPlanForFoodTruck = async (foodTruck, nextPlanId = null) => {
  const planId = nextPlanId || foodTruck?.planId;
  return planId ? PlanService.getById(planId) : null;
};

const assertPlanChangeAllowedForCurrentData = async (foodTruck, nextPlanId) => {
  const plan = await getPlanForFoodTruck(foodTruck, nextPlanId);
  assertSocialMediaLinksAllowed(plan, foodTruck.socialMedia || []);

  const newDishCount = await MenuItemService.getCount({
    userId: foodTruck.userId,
    deletedAt: null,
    newDish: true,
  });

  if (newDishCount > 0) {
    assertNewDishHighlightAllowed(plan);
  }
};

/**
 * Helper to process BOGO items and handle isSameItem logic
 * @param {Object} item - Menu item object
 * @returns {Object} - Processed menu item
 */
const processBogoItems = (item) => {
  if (item && item.bogoItems && Array.isArray(item.bogoItems)) {
    item.bogoItems = item.bogoItems.map((bogo) => {
      if (bogo.isSameItem) {
        // Use parent item details for same-item reward
        return {
          ...bogo,
          itemId: {
            _id: item._id,
            name: item.name,
            description: item.description,
            imgUrls: item.imgUrls,
            price: item.strikePrice || item.price,
            strikePrice: item.strikePrice,
            discountType: item.discountType,
            hasDiscount: item.hasDiscount,
            discountRules: item.discountRules,
            available: item.available,
            itemType: item.itemType,
            categoryId: item.categoryId,
            meatId: item.meatId,
            diet: item.diet,
            predefinedDiscountId: item.predefinedDiscountId,
            minQty: item.minQty,
            maxQty: item.maxQty,
          },
        };
      }
      return bogo;
    });
  }
  return item;
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
      query: {
        limit = 10,
        page = 1,
        userLat,
        userLong,
        distanceInMeters,
        search,
      },
      params: { id: _id },
      user,
    } = req;
    if (_id) {
      let item = await Service.getByData(
        { _id: _id },
        { singleResult: true, populate: ['cuisine', 'planId'] }
      );

      if (!item) {
        return res.error(new Error('No food truck found'), 409);
      }

      if (item) {
        item = item.toObject();
      }

      if (item && item.planId && typeof item.planId === 'object') {
        item.plan = normalizeVendorPlan(item.planId);
        item.planId = item.plan._id;
      }

      if (user?.userType === 'CUSTOMER') {
        item.isFavorite = !!(await FavoriteFoodTruckService.getByData({
          userId: user._id,
          foodTruckId: _id,
        }));
      }

      const rating = await Service.getRatting([item]);
      item.avgRate = rating[item._id.toString()].avgRate || 0;
      item.totalReviews = rating[item._id.toString()].totalReviews || 0;

      return res.data(
        { [`${entityName.toLocaleLowerCase()}`]: item },
        `${entityName} item`
      );
    }

    let extraQ = {
      inactive: false,
      verified: true,
    };

    if (user?.userType === 'VENDOR') {
      extraQ = { userId: user._id.toString() };
    }

    if (user?.userType === 'SUPER_ADMIN') {
      extraQ = {};
    }

    let q = {};
    if (search && search.trim()) {
      q = {
        $or: [{ name: { $regex: search.trim().toLowerCase(), $options: 'i' } }],
      };
    }

    if (user?.userType === 'CUSTOMER') {
      const { data, total } = await Service.getNormalList(
        limit,
        page,
        q,
        extraQ,
        user,
        userLat,
        userLong,
        distanceInMeters
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
    }

    let data = await Service.getByData(
      { ...q, ...extraQ },
      {
        paging: { limit, page },
        populate: ['cuisine', 'addOns'],
        lean: true,
        sort: { createdAt: -1 },
      }
    );

    const rating = await Service.getRatting(data);
    data = (data || []).map((itm) => ({
      ...itm,
      ...(rating[itm._id.toString()] || {}),
    }));

    const total = await Service.getCount({
      ...q,
      ...extraQ,
    });
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
    return next(e);
  }
};

exports.getMenu = async (req, res, next) => {
  try {
    let {
      params: { id: _id },
      user,
    } = req;

    const ft = await Service.getById(_id);
    if (!ft) {
      return res.error(new Error('No food truck found'), 409);
    }
    let userRestrictDiet = [];

    if (user?.userType === 'CUSTOMER') {
      const restrictData = await UserRestictDietService.getByData(
        { userId: user._id, deletedAt: null },
        { singleResult: true, lean: true }
      );
      userRestrictDiet = restrictData?.diet || [];
    }
    let query = { userId: ft.userId };
    if (userRestrictDiet.length > 0) {
      query.diet = { $nin: userRestrictDiet }; // exclude items with restricted diet
    }
    const data = (
      await MenuItemService.getByData(query, {
        lean: true,
        populate: [
          // 'categoryId',
          {
            path: 'categoryId',
            match: {
              categoriesId: { $ne: null },
            },
            populate: {
              path: 'categoriesId',
              select: { _id: 1, name: 1 },
            },
          },
          'meatId',
          'diet',
          {
            path: 'subItem.menuItem',
            select: {
              _id: 1,
              name: 1,
              description: 1,
              imgUrls: 1,
              price: 1,
              strikePrice: 1,
              discountType: 1,
              hasDiscount: 1,
              discountRules: 1,
              available: 1,
              itemType: 1,
              categoryId: 1,
              meatId: 1,
              diet: 1,
              predefinedDiscountId: 1,
              minQty: 1,
              maxQty: 1,
            },
          },
          {
            path: 'bogoItems.itemId',
            select: {
              _id: 1,
              name: 1,
              description: 1,
              imgUrls: 1,
              price: 1,
              strikePrice: 1,
              discountType: 1,
              hasDiscount: 1,
              discountRules: 1,
              available: 1,
              itemType: 1,
              categoryId: 1,
              meatId: 1,
              diet: 1,
              predefinedDiscountId: 1,
              minQty: 1,
              maxQty: 1,
            },
          },
        ],
      })
    )
      .filter((item) => item.categoryId)
      .map((item) => {
        if (item && item.categoryId && typeof item.categoryId === 'object') {
          item.category = item.categoryId;
          if (item.categoryId.categoriesId.name) {
            item.category.name = item.categoryId.categoriesId.name;
          }
          item.categoryId = item.category._id;
        }
        if (item && item.meatId && typeof item.meatId === 'object') {
          item.meat = item.meatId;
          item.meatId = item.meat._id;
        }

        // Handle isSameItem logic
        item = processBogoItems(item);

        return item;
      });
    // console.log("Dd",data)
    return res.data(
      {
        menuList: data,
      },
      `menu items`
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
      body: {
        name,
        // facebookLink,
        // instagramLink,
        logo,
        photos,
        cuisine,
        infoType,
        locations,
        availability,
        businessHours,
        currentLocation,
        planId,
        socialMedia,
        ein,
        // snn,
        ssn,
	        addOns,
	        documents,
	        availabilityChangeDay,
	      },
      params: { id },
      user,
    } = req;

    const customError = new Error();
    customError.code = 409;

    const item = await Service.getByData(
      { _id: id, ...(user.userType === 'VENDOR' ? { userId: user._id } : {}) },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 409);
    }
    ensureDefaultTruckUnits(item);

    if (name) {
      item.name = name;
      ensureDefaultTruckUnits(item);
    }

    // if (facebookLink) {
    //   item.facebookLink = facebookLink;
    // }
    //
    // if (instagramLink) {
    //   item.instagramLink = instagramLink;
    // }
    if (socialMedia !== undefined) {
      const plan = await getPlanForFoodTruck(item, planId || null);
      assertSocialMediaLinksAllowed(plan, socialMedia);
      item.socialMedia = socialMedia;
    }

    if (logo) {
      item.logo = logo;
    }

    if (photos) {
      item.photos = photos;
    }

    if (documents !== undefined) {
      item.documents = documents;
    }

    if (cuisine) {
      item.cuisine = cuisine;
    }

    if (infoType) {
      item.infoType = infoType;
    }

    if (locations) {
      item.locations = normalizeLocations(locations, item.locations);
      syncOrderingLocationFlags(item);
    }

	    if (availability) {
	      const previousAvailability = cloneAvailability(item.availability);
	      const nextAvailability = cloneAvailability(availability);
	      if (
	        normalizeAvailabilityForCompare(previousAvailability) !==
	        normalizeAvailabilityForCompare(nextAvailability)
	      ) {
	        item.availabilityHistory = [
	          ...(item.availabilityHistory || []),
	          {
	            archivedAt: new Date(),
	            changedByUserId: user?._id || null,
	            changedDay: availabilityChangeDay || null,
	            previousAvailability,
	            newAvailability: nextAvailability,
	          },
	        ];
	      }
	      item.availability = availability;
	    }

    if (businessHours) {
      item.businessHours = businessHours;
    }

    if (planId) {
      await assertPlanChangeAllowedForCurrentData(item, planId);
      item.planId = planId;
    }

    if (ein !== undefined) {
      item.ein = ein;
    }

    // if (snn !== undefined) {
    //   item.snn = snn;
    // }

    if (ssn !== undefined) {
      item.ssn = ssn;
    }

    if (addOns) {
      item.addOns = addOns;
    }

    if (currentLocation || currentLocation === null) {
      // Check if food truck has available menu items
      const menuItemsCount = await MenuItemService.getCount({
        userId: item.userId,
        deletedAt: null,
        available: true,
      });

      // Only update currentLocation if there are available menu items
      if (menuItemsCount > 0) {
        item.currentLocation = currentLocation;
      } else {
        // If no menu items available, prevent location update and send error
        if (currentLocation !== null) {
          return res.error(
            new Error('Cannot set location when no menu items are available'),
            409
          );
        }
        item.currentLocation = null;
      }

      syncOrderingLocationFlags(item);
    }

    await item.save();

    // To return populated data
    let latest = await Service.getByData(
      { _id: id },
      { singleResult: true, populate: ['cuisine', 'addOns'] }
    );

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: latest },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

exports.addDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, document_type, replace_existing } = req.body;
    const { user } = req;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded!' });
    }

    const item = await Service.getByData(
      { _id: id, ...(user.userType === 'VENDOR' ? { userId: user._id } : {}) },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 409);
    }

    const documentTitle = String(title || req.file.originalname || 'Document').trim();
    const documentName = normalizeDocumentName(documentTitle || req.file.originalname);
    const duplicateDocuments = (item.documents || []).filter((document) => {
      const existingName = normalizeDocumentName(
        document.title || document.original_name
      );
      return (
        existingName &&
        existingName === documentName &&
        document.document_status !== 'ARCHIVED'
      );
    });
    const duplicateDocument = duplicateDocuments[0];
    const shouldReplaceExisting =
      replace_existing === true ||
      String(replace_existing || '').toLowerCase() === 'true';

    if (duplicateDocument && !shouldReplaceExisting) {
      fs.unlink(req.file.path, () => {});
      return res.status(409).json({
        message: 'A vendor document with this name already exists.',
      });
    }

    const { url, key } = await addObjectWithKey(
      req.file,
      `food-truck-documents/${id}`
    );
    fs.unlink(req.file.path, () => {});

    if (duplicateDocument && shouldReplaceExisting) {
      const archiveDate = new Date();
      duplicateDocuments.forEach((document) => {
        document.document_status = 'ARCHIVED';
        document.archived_at = archiveDate;
        document.archived_reason = 'Replaced by newer vendor document';
        document.archived_by_user_id = user._id;
        document.replaced_by_file_key = key;
      });
    }

    const document = {
      title: documentTitle,
      document_type: normalizeDocumentType(document_type),
      file_url: url,
      file_key: key,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      uploaded_by_user_id: user._id,
      uploaded_at: new Date(),
      document_status: 'ACTIVE',
    };

    item.documents = [...(item.documents || []), document];
    await item.save();

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} document uploaded`
    );
  } catch (e) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return next(e);
  }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const { id, documentId } = req.params;
    const { user } = req;

    const item = await Service.getByData(
      { _id: id, ...(user.userType === 'VENDOR' ? { userId: user._id } : {}) },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 409);
    }

    const document = (item.documents || []).id(documentId);
    if (!document) {
      return res.error(new Error('No document found'), 404);
    }

    const fileKey = document.file_key;
    item.documents.pull({ _id: documentId });
    await item.save();

    if (fileKey) {
      await removeObject(fileKey);
    }

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} document deleted`
    );
  } catch (e) {
    return next(e);
  }
};

exports.callComplete = async (req, res, next) => {
  try {
    const { user } = req;

    const customError = new Error();
    customError.code = 409;

    const item = await Service.getByData(
      { userId: user._id },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 409);
    }

    // if (!item.availability?.length) {
    //   return res.error(new Error('Vendor details are not completed yet'), 409);
    // }

    if (item.completed) {
      return res.error(new Error('Already submitted'), 409);
    }

    // const bank = await BankDetailService.getByData(
    //   { userId: user._id },
    //   { singleResult: true }
    // );
    // if (!bank) {
    //   return res.error(new Error('Bank details not provided yet'), 409);
    // }

    const vendor = await UserService.getById(user._id);
    if (vendor) {
      await MailHelper.sendWelcomeToVendor(vendor);
    }

    item.completed = true;

    await item.save();

    return res.message(`Submitted`);
  } catch (e) {
    return next(e);
  }
};

exports.updateExtra = async (req, res, next) => {
  try {
    const {
      body: { featured },
      params: { id },
    } = req;

    const customError = new Error();
    customError.code = 409;

    const item = await Service.getByData({ _id: id }, { singleResult: true });

    if (!item) {
      return res.error(new Error('No food truck found'), 409);
    }

    if ([true, false].includes(featured)) {
      item.featured = featured;
    }

    await item.save();

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

exports.toggleLocationOrdering = async (req, res, next) => {
  try {
    const {
      body: { isOrderingOpen, truck_unit_id },
      params: { id, locationId },
      user,
    } = req;

    const item = await Service.getByData(
      {
        _id: id,
        ...(user.userType === 'EMPLOYEE'
          ? { userId: user.vendor_user_id }
          : user.userType === 'VENDOR'
          ? { userId: user._id }
          : {}),
      },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 404);
    }

    ensureDefaultTruckUnits(item);

    if (
      user.userType === 'EMPLOYEE' &&
      (item._id.toString() !== user.food_truck_id?.toString() ||
        locationId?.toString() !== user.assigned_location_id?.toString() ||
        !user.assigned_truck_unit_id ||
        !truck_unit_id ||
        user.assigned_truck_unit_id?.toString() !== truck_unit_id?.toString())
    ) {
      return res.error(new Error('Location not found or access denied'), 403);
    }

    if (user.userType === 'EMPLOYEE' && !user.is_working) {
      return res.error(
        new Error('Employee status must be Working before changing store status'),
        403
      );
    }

    const locationExists = (item.locations || []).some(
      (loc) => loc._id?.toString() === locationId?.toString()
    );

    if (!locationExists) {
      return res.error(new Error('Location not found'), 404);
    }

    if (isOrderingOpen) {
      if (user.userType === 'VENDOR') {
        await VendorComplianceService.assertEligible(item, 'open and accept orders');
      }

      const menuItemsCount = await MenuItemService.getCount({
        userId: item.userId,
        deletedAt: null,
        available: true,
      });

      if (menuItemsCount <= 0) {
        return res.error(
          new Error('Cannot open location when no menu items are available'),
          409
        );
      }

      setTruckUnitLocationOpen({
        foodTruck: item,
        truckUnitId: truck_unit_id || user.assigned_truck_unit_id || null,
        locationId,
        isOpen: true,
        closeOtherLocations: user.userType === 'EMPLOYEE',
      });
    } else {
      setTruckUnitLocationOpen({
        foodTruck: item,
        truckUnitId: truck_unit_id || user.assigned_truck_unit_id || null,
        locationId,
        isOpen: false,
      });
    }

    await item.save();

    if (user.userType === 'EMPLOYEE') {
      await EmployeeSessionService.touchSession(
        user.employee_session_id,
        user.employee_internal_id
      );
    }

    const latest = await Service.getByData(
      { _id: id },
      { singleResult: true, populate: ['cuisine', 'addOns', 'planId'] }
    );

    if (latest?.planId && typeof latest.planId === 'object') {
      latest.plan = normalizeVendorPlan(latest.planId);
      latest.planId = latest.plan._id;
    }

    const responseFoodTruck =
      user.userType === 'EMPLOYEE'
        ? {
            _id: latest._id,
            name: latest.name,
            logo: latest.logo,
            currentLocation: latest.currentLocation,
            locations: (latest.locations || []).filter(
              (loc) => loc._id?.toString() === locationId?.toString()
            ),
          }
        : latest;

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: responseFoodTruck },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

exports.updateTruckUnits = async (req, res, next) => {
  try {
    const {
      body: { food_truck_count, create_name, reactivate_truck_unit_id },
      params: { id },
      user,
    } = req;

    const item = await Service.getByData(
      { _id: id, userId: user._id },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 404);
    }

    ensureDefaultTruckUnits(item);
    const targetCount = Number(food_truck_count);
    const activeCount = getActiveTruckUnits(item).length;

    if (targetCount < 1) {
      return res.error(new Error('At least one food truck is required'), 409);
    }

    if (targetCount < activeCount) {
      archiveExtraTruckUnits(item, targetCount);
    } else if (targetCount > activeCount) {
      const plan = await getPlanForFoodTruck(item);
      if (!canUseMultipleTruckUnits(plan)) {
        return res.error(
          new Error('Multiple food trucks are available on the Elite plan.'),
          403
        );
      }
      const needed = targetCount - activeCount;
      if (reactivate_truck_unit_id) {
        reactivateTruckUnit(item, reactivate_truck_unit_id);
      } else if (create_name) {
        const phoneDigits = toPhoneDigits(req.body.phone);
        if (!phoneDigits) {
          return res.error(new Error('Truck phone number is required'), 400);
        }
        createTruckUnit(item, create_name, phoneDigits);
      } else {
        const archived = getArchivedTruckUnits(item).filter((unit) => !unit.is_primary);
        return res.data(
          {
            actionRequired: true,
            reason: 'TRUCK_UNIT_CHOICE_REQUIRED',
            needed,
            archived_truck_units: archived,
          },
          'Choose whether to create a new truck or reactivate an existing truck'
        );
      }

      if (needed > 1) {
        const error = new Error('Add one truck name at a time');
        error.code = 409;
        throw error;
      }
    }

    ensureDefaultTruckUnits(item);
    await item.save();

    const latest = await Service.getByData(
      { _id: id },
      { singleResult: true, populate: ['cuisine', 'addOns', 'planId'] }
    );

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: latest },
      `${entityName} truck names updated`
    );
  } catch (e) {
    return next(e);
  }
};

exports.updateTruckUnit = async (req, res, next) => {
  try {
    const {
      body: { name, phone, is_archived },
      params: { id, truckUnitId },
      user,
    } = req;

    const item = await Service.getByData(
      { _id: id, userId: user._id },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 404);
    }

    const unit = findTruckUnit(item, truckUnitId);
    if (!unit) {
      return res.error(new Error('Truck name not found'), 404);
    }
    if (unit.is_primary && name && name !== item.name) {
      return res.error(
        new Error('Truck 1 name can only be changed by contacting support'),
        409
      );
    }

    if (!unit.is_primary && name !== undefined) {
      unit.name = name;
    }
    if (!unit.is_primary && phone !== undefined) {
      const phoneDigits = toPhoneDigits(phone);
      if (!phoneDigits) {
        return res.error(new Error('Truck phone number is required'), 400);
      }
      unit.phone = phoneDigits;
    }
    if (!unit.is_primary && is_archived !== undefined) {
      if (unit.is_archived && is_archived === false) {
        const plan = await getPlanForFoodTruck(item);
        const activeCount = getActiveTruckUnits(item).length;
        if (!canUseMultipleTruckUnits(plan) && activeCount >= 1) {
          return res.error(
            new Error('Multiple food trucks are available on the Elite plan.'),
            403
          );
        }
      }
      unit.is_archived = !!is_archived;
      unit.archived_at = unit.is_archived ? new Date() : null;
      if (unit.is_archived) {
        unit.open_locations = [];
      }
    }

    ensureDefaultTruckUnits(item);
    syncOrderingLocationFlagsFromTruckUnits(item);
    await item.save();

    return res.data(
      { truckUnit: unit, foodtruck: item },
      'Truck name updated'
    );
  } catch (e) {
    return next(e);
  }
};

exports.deleteLocation = async (req, res, next) => {
  try {
    const {
      params: { id, locationId },
      user,
    } = req;

    const customError = new Error();
    customError.code = 409;

    const item = await Service.getByData(
      { _id: id, ...(user.userType === 'VENDOR' ? { userId: user._id } : {}) },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 409);
    }

    item.locations = (item.locations || []).filter(
      (item) => item._id.toString() !== locationId
    );
    ensureDefaultTruckUnits(item);
    item.truck_units = (item.truck_units || []).map((unit) => {
      unit.open_locations = (unit.open_locations || []).filter(
        (loc) => loc.locationId?.toString() !== locationId
      );
      return unit;
    });
    syncOrderingLocationFlagsFromTruckUnits(item);
    item.markModified('truck_units');
    item.markModified('locations');
    item.markModified('currentLocation');

    await item.save();

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} location deleted`
    );
  } catch (e) {
    return next(e);
  }
};

exports.filterFT = async (req, res, next) => {
  try {
    let {
      query: {
        limit = 10,
        page = 1,
        search,
        day,
        time,
        userLat,
        userLong,
        distanceInMeters,
      },
      user,
    } = req;
    let { data, total } = await Service.getWithFilters(
      day,
      time,
      userLat,
      userLong,
      limit,
      page,
      search,
      distanceInMeters
    );
    if (user?.userType === 'CUSTOMER') {
      const fav = {};
      (
        await FavoriteFoodTruckService.getByData({
          userId: user._id,
          foodTruckId: { $in: (data || []).map((item) => item._id) },
        })
      ).forEach((item) => {
        fav[item.foodTruckId.toString()] = true;
      });

      data = data.map((item) => {
        item.isFavorite = !!fav[item._id.toString()];
        return item;
      });
    }
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

exports.filterNewFT = async (req, res, next) => {
  try {
    let {
      query: {
        limit = 10,
        page = 1,
        search,
        // day,
        // time,
        userLat,
        userLong,
        distanceInMeters,
        available,
        featured,
      },
      user,
    } = req;

    let { data, total } = await Service.getWithFiltersNew(
      user,
      null,
      null,
      userLat,
      userLong,
      limit,
      page,
      search,
      distanceInMeters,
      available,
      featured
    );
    if (user?.userType === 'CUSTOMER') {
      const fav = {};
      (
        await FavoriteFoodTruckService.getByData({
          userId: user._id,
          foodTruckId: { $in: (data || []).map((item) => item._id) },
        })
      ).forEach((item) => {
        fav[item.foodTruckId.toString()] = true;
      });

      data = data.map((item) => {
        item.isFavorite = !!fav[item._id.toString()];
        return item;
      });
    }
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

exports.nearMe = async (req, res, next) => {
  try {
    const {
      query: {
        limit = 50,
        page = 1,
        search,
        userLat,
        userLong,
        distanceInMeters,
        cuisineIds,
        cuisines,
        eventTypes,
        type = 'ALL',
      },
      user,
    } = req;

    const normalizedType = String(type || 'ALL').toUpperCase();
    const includeFood = normalizedType === 'ALL' || normalizedType === 'FOOD';
    const includeEvents = normalizedType === 'ALL' || normalizedType === 'EVENT';
    const numericLimit = Number(limit || 50);
    const numericPage = Number(page || 1);
    const numericUserLat = toNumberOrNull(userLat);
    const numericUserLong = toNumberOrNull(userLong);
    const numericDistance = toNumberOrNull(distanceInMeters);
    const selectedCuisineIds = parseCsvParam(cuisineIds);
    const selectedCuisines = parseCsvParam(cuisines);
    const selectedEventTypes = parseCsvParam(eventTypes);

    const [foodResult, eventList] = await Promise.all([
      includeFood
        ? Service.getWithFiltersNew(
            user,
            null,
            null,
            userLat,
            userLong,
            numericLimit,
            numericPage,
	            search,
	            distanceInMeters,
	            false,
	            null
	          )
        : { data: [], total: 0 },
      includeEvents
        ? MarketplaceEventService.getByData(
            { status: 'OPEN', event_visibility: 'PUBLIC' },
            {
              sort: { event_date: 1, event_time: 1, created_at: -1 },
              lean: true,
            }
          )
        : [],
    ]);

    const eventIds = eventList.map((event) => event.event_id);
    const eventImages = eventIds.length
      ? await MarketplaceEventImageService.getByData(
          { event_id: { $in: eventIds }, status: 'ACTIVE' },
          { sort: { created_at: 1 }, lean: true }
        )
      : [];
    const imagesByEventId = eventImages.reduce((acc, image) => {
      if (!acc[image.event_id]) acc[image.event_id] = [];
      acc[image.event_id].push(image);
      return acc;
    }, {});

    const foodItems = (foodResult?.data || [])
      .flatMap((truck) => {
        const openLocations = getOpenTruckLocationCandidates(
          truck,
          numericUserLat,
          numericUserLong
        );

        if (!openLocations.length) {
          return [normalizeNearMeFood(truck, numericUserLat, numericUserLong)];
        }

        return openLocations.map((openLocation) =>
          normalizeNearMeFood(
            truck,
            numericUserLat,
            numericUserLong,
            openLocation
          )
        );
      })
      .filter((item) =>
        matchesFoodCuisineFilters(item, selectedCuisineIds, selectedCuisines)
      );
    const eventItems = eventList
      .filter((event) => matchesEventSearch(event, search))
      .filter((event) => matchesEventTypeFilters(event, selectedEventTypes))
      .map((event) =>
        normalizeNearMeEvent(
          event,
          imagesByEventId,
          numericUserLat,
          numericUserLong
        )
      )
      .filter((event) => {
        if (!numericDistance || event.distance === null) return true;
        return event.distance <= numericDistance;
      });

    const nearMeList = [...foodItems, ...eventItems]
      .sort((a, b) => {
        const aDistance = a.distance ?? Number.POSITIVE_INFINITY;
        const bDistance = b.distance ?? Number.POSITIVE_INFINITY;
        return aDistance - bDistance;
      })
      .slice(0, numericLimit);

    return res.data(
      {
        nearMeList,
        foodtruckList: foodItems,
        marketplaceEventList: eventItems,
        total: nearMeList.length,
        page: numericPage,
        totalPages: 1,
      },
      'Near Me items'
    );
  } catch (e) {
    console.log(e);
    return next(e);
  }
};

exports.changePlan = async (req, res, next) => {
  try {
    const {
      body: { planId },
      user,
    } = req;

    const customError = new Error();
    customError.code = 409;

    const item = await Service.getByData(
      { userId: user._id },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 409);
    }

    if (planId.toString() !== item.planId.toString()) {
      if (item.planUpdateDate) {
        const planDate = new Date(item.planUpdateDate);
        planDate.setMonth(planDate.getMonth() + 3);
        const now = new Date();
        if (planDate > now) {
          return res.error(
            new Error(
              'You can not change the plan before 3 months from the last plan update.'
            ),
            409
          );
        }
      }

      await assertPlanChangeAllowedForCurrentData(item, planId);
      item.planId = planId;
      item.planUpdateDate = new Date().toISOString();
    }

    await item.save();

    // To return populated data
    let latest = await Service.getByData(
      { _id: item._id },
      { singleResult: true, populate: ['cuisine', 'addOns'] }
    );

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: latest },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

exports.changeaddonPlan = async (req, res, next) => {
  try {
    const {
      body: { addOns },
      user,
    } = req;

    const customError = new Error();
    customError.code = 409;

    const item = await Service.getByData(
      { userId: user._id },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 409);
    }

    const oldAddOns = (item.addOns || []).map((id) => id.toString()).sort();
    const newAddOns = (addOns || []).map((id) => id.toString()).sort();
    const addOnsChanged =
      JSON.stringify(oldAddOns) !== JSON.stringify(newAddOns);

    if (addOnsChanged) {
      if (item.addOnPlanUpdateDate) {
        const planDate = new Date(item.addOnPlanUpdateDate);
        planDate.setMonth(planDate.getMonth() + 3);
        const now = new Date();
        if (planDate > now) {
          return res.error(
            new Error(
              'You can not change the add on plan before 3 months from the last add on plan update.'
            ),
            409
          );
        }
      }

      item.addOns = addOns;
      item.addOnPlanUpdateDate = new Date().toISOString();
    }

    await item.save();

    // To return populated data
    let latest = await Service.getByData(
      { _id: item._id },
      { singleResult: true, populate: ['cuisine', 'addOns'] }
    );

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: latest },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

exports.globalSearch = async (req, res, next) => {
  try {
    let {
      query: { search, userLat, userLong },
      user,
    } = req;

    let userRestrictDiet = [];
    if (user?.userType === 'CUSTOMER') {
      const restrictData = await UserRestictDietService.getByData(
        { userId: user._id, deletedAt: null },
        { singleResult: true, lean: true }
      );
      userRestrictDiet = restrictData?.diet || [];
    }

    let { data, total } = await Service.getWithFiltersNew(
      null,
      null,
      null,
      userLat,
      userLong,
      7,
      1,
      search,
      null,
      null,
      null
    );
    const fav = {};
    if (user?.userType === 'CUSTOMER') {
      (
        await FavoriteFoodTruckService.getByData({
          userId: user._id,
          foodTruckId: { $in: (data || []).map((item) => item._id) },
        })
      ).forEach((item) => {
        fav[item.foodTruckId.toString()] = true;
      });
    }
    data = data.map((item) => {
      if (user?.userType === 'CUSTOMER') {
        item.isFavorite = !!fav[item._id.toString()];
      }
      item.recordType = 'FOOD_TRUCK';
      return item;
    });
    data = [
      ...data,
      ...(
        await MenuItemService.getLimitedDistinct(7, search, userRestrictDiet)
      ).map((itm) => {
        itm.recordType = 'MENU_ITEM';
        return itm;
      }),
    ];
    return res.data({
      [`searchList`]: data,
    });
  } catch (e) {
    console.log(e);
    return next(e);
  }
};
