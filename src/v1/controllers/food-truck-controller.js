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
  normalizeVendorPlan,
} = require('../../helper/vendor-plan-helper');
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

const normalizeNearMeFood = (truck) => {
  const matchedMenuItem = truck.matchedMenuItems?.[0] || truck.menu?.[0] || null;
  const imageUrl =
    matchedMenuItem?.imgUrls?.[0] || truck.logo || truck.photos?.[0] || null;
  const location = truck.location || null;

  return {
    type: 'FOOD',
    marker_type: 'TRUCK',
    id: matchedMenuItem?._id?.toString() || truck._id?.toString(),
    food_truck_id: truck._id,
    menu_item_id: matchedMenuItem?._id || null,
    title: matchedMenuItem?.name || truck.name,
    name: matchedMenuItem?.name || truck.name,
    food_truck_name: truck.name,
    description: getFoodPreview(truck, matchedMenuItem),
    preview: getFoodPreview(truck, matchedMenuItem),
    location,
    address: location?.address || location?.title || '',
    latitude: toNumberOrNull(location?.lat),
    longitude: toNumberOrNull(location?.long),
    image_url: imageUrl,
    distance: truck.distanceInMeters ?? null,
    distanceInMeters: truck.distanceInMeters ?? null,
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

const syncOrderingLocationFlags = (foodTruck) => {
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

    if (name) {
      item.name = name;
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
      body: { isOrderingOpen },
      params: { id, locationId },
      user,
    } = req;

    const item = await Service.getByData(
      {
        _id: id,
        ...(user.userType === 'EMPLOYEE'
          ? { userId: user.vendor_user_id }
          : { userId: user._id }),
      },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('No food truck found'), 404);
    }

    if (
      user.userType === 'EMPLOYEE' &&
      (item._id.toString() !== user.food_truck_id?.toString() ||
        locationId?.toString() !== user.assigned_location_id?.toString())
    ) {
      return res.error(new Error('Location not found or access denied'), 403);
    }

    const locationExists = (item.locations || []).some(
      (loc) => loc._id?.toString() === locationId?.toString()
    );

    if (!locationExists) {
      return res.error(new Error('Location not found'), 404);
    }

    if (isOrderingOpen) {
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

      item.currentLocation = locationId;
    } else if (item.currentLocation?.toString() === locationId?.toString()) {
      item.currentLocation = null;
    }

    syncOrderingLocationFlags(item);
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
            true,
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
      .map(normalizeNearMeFood)
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
