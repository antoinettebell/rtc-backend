const {
  UserService: Service,
  FoodTruckService,
  FavoriteFoodTruckService,
  AddressService,
  BankDetailService,
  OrderService,
  SettingService,
  AdminNotificationService,
} = require('../services');
const EncryptionService = require('../../helper/encryption');
const bcrypt = require('bcrypt');
const entityName = 'User';
const MailHelper = require('../../helper/mail-helper');
const Utils = require('../../helper/utils');
const disposableDomains = require('disposable-email-domains');
const CustomNotification = require('../../helper/custom-notification');

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
        search,
        userType,
        status,
        inactive,
        profileComplete,
      },
      params: { id: _id },
    } = req;
    if (_id) {
      let item = await Service.getById(_id);
      if (item) {
        item = item.toObject();
        delete item.password;
        delete item.changePassToken;

        if (item.userType === 'VENDOR') {
          item.foodTruck = await FoodTruckService.getByData(
            { userId: item._id },
            {
              singleResult: true,
              lean: true,
              populate: ['cuisine', 'addOns', 'planId'],
            }
          );
          if (item.foodTruck) {
            if (
              item.foodTruck.planId &&
              typeof item.foodTruck.planId === 'object'
            ) {
              item.foodTruck.plan = item.foodTruck.planId;
              item.foodTruck.planId = item.foodTruck.plan._id;
            }

            const rating = await FoodTruckService.getRatting([item.foodTruck]);
            item.foodTruck.avgRate =
              rating[item.foodTruck._id.toString()].avgRate || 0;
            item.foodTruck.totalReviews =
              rating[item.foodTruck._id.toString()].totalReviews || 0;
          }

          // Add bank details for vendors (encrypted for frontend)
          const bankDetail = await BankDetailService.getByData(
            { userId: item._id },
            { singleResult: true, lean: true }
          );

          if (bankDetail) {
            // Encrypt bank details before sending to frontend
            item.bankDetail = EncryptionService.encryptFields(bankDetail, [
              'accountHolderName',
              'bankName',
              'accountNumber',
              'routingNumber',
              'accountType',
              'remittanceEmail',
              'currency',
              'swiftCode',
              'iban',
              'paymentMethod',
              "bankAddressLine1",
              "bankAddressLine2",
              "bankCity",
              "bankState",
              "bankPostal",
            ]);
          }
        }
      }
      return res.data(
        { [`${entityName.toLocaleLowerCase()}`]: item },
        `${entityName} item`
      );
    }

    if (userType === 'VENDOR') {
      const resData = await Service.getVendorWithFoodTruck(
        limit,
        page,
        search,
        status,
        inactive,
        profileComplete
      );

      return res.data(
        {
          [`${entityName.toLocaleLowerCase()}List`]: resData.data,
          total: resData.total,
          page,
          totalPages:
            resData.total < limit ? 1 : Math.ceil(resData.total / limit),
        },
        `${entityName} items`
      );
    }

    let q = {};
    if (search && search.trim()) {
      q = {
        $or: [
          { email: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          { firstName: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          { lastName: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          {
            mobileNumber: {
              $regex: search.trim().toLowerCase(),
              $options: 'i',
            },
          },
        ],
      };
    }
    q['$and'] = [
      { userType },
      { verified: true },
      ...(status ? [{ requestStatus: status }] : []),
      ...(inactive === 'inactive' ? [{ inactive: true }] : []),
    ];
    const data = (
      await Service.getByData(
        { ...q, userType: { $nin: ['SUPER_ADMIN'] } },
        { paging: { limit, page }, lean: true, sort: { createdAt: -1 } }
      )
    ).map((item) => {
      delete item.password;
      delete item.changePassToken;
      return item;
    });

    const total = await Service.getCount({
      ...q,
      userType: { $ne: 'SUPER_ADMIN' },
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

/**
 * To add entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
// exports.add = async (req, res, next) => {
//   try {
//     let {
//       body: { email, firstName, lastName, password },
//     } = req;
//
//     const emailExists = await Service.getByData(
//       {
//         email: { $regex: `\\b${email}\\b`, $options: 'i' },
//       },
//       { singleResult: true }
//     );
//     if (emailExists) {
//       return res.message(`User with this email is already exists`, 409);
//     }
//
//     let data = await Service.create({
//       email,
//       firstName,
//       lastName,
//       password,
//       verified: true,
//     });
//
//     return res.data(
//       { [`${entityName.toLocaleLowerCase()}`]: data },
//       `${entityName} created`
//     );
//   } catch (e) {
//     return next(e);
//   }
// };

/**
 * To update entry to given collection
 * Support PUT request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.update = async (req, res, next) => {
  try {
    let {
      body: {
        firstName,
        lastName,
        profilePic,
        countryCode,
        mobileNumber,
        password,
        addressLine1,
        addressLine2,
        addressCity,
        addressState,
        addressCountry,
        addressPostal,
        // mailing,
      },
      params: { id: _id },
      user,
    } = req;

    if (user.userType !== 'SUPER_ADMIN' && _id !== user._id.toString()) {
      return res.message(`You doesn't have access to this route`, 409);
    }

    let existRecord = await Service.getById(_id);
    if (!existRecord) {
      return res.message(`user not found`, 409);
    }

    if (firstName) {
      existRecord.firstName = firstName;
    }

    if (lastName) {
      existRecord.lastName = lastName;
    }

    if (profilePic) {
      existRecord.profilePic = profilePic;
    }

    if (countryCode) {
      existRecord.countryCode = countryCode;
    }

    if (mobileNumber) {
      existRecord.mobileNumber = mobileNumber;
    }

    // if (mailing) {
    //   existRecord.mailing = mailing;
    // } 
    if (addressLine1) existRecord.addressLine1 = addressLine1;
    if (addressLine2) existRecord.addressLine2 = addressLine2;
    if (addressState) existRecord.addressState = addressState;
    if (addressCity) existRecord.addressCity = addressCity;
    if (addressCountry) existRecord.addressCountry = addressCountry;
    if (addressPostal) existRecord.addressPostal = addressPostal;

    if (password && user.userType === 'SUPER_ADMIN') {
      existRecord.password = password;
    }

    await existRecord.save();

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: existRecord },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To change password entry to given collection
 * Support PUT request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.changePassword = async (req, res, next) => {
  try {
    let {
      body: { currentPassword, newPassword },
      params: { id },
      user,
    } = req;

    if (user.userType !== 'SUPER_ADMIN' && id !== user._id.toString()) {
      return res.message(`You doesn't have access to this route`, 409);
    }

    const existRecord = await Service.getById(id);
    if (!existRecord) {
      return res.message(`user not found`, 409);
    }

    const isMatching = await bcrypt.compare(
      currentPassword,
      existRecord.password
    );
    if (!isMatching) {
      return res.message(`Current Password is not valid`, 409);
    }
    if (newPassword) {
      existRecord.password = newPassword;
    }

    await existRecord.save();
    return res.message(`Your password is Updated`);
  } catch (e) {
    return next(e);
  }
};

/**
 * To change status to given collection
 * Support PUT request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.changeStatus = async (req, res, next) => {
  try {
    let {
      body: { inactive },
      params: { id: _id },
    } = req;

    const existRecord = await Service.getByData(
      { _id, userType: { $ne: 'SUPER_ADMIN' } },
      { singleResult: true }
    );
    if (!existRecord) {
      return res.message(`user not found`, 409);
    }

    existRecord.inactive = inactive;

    await existRecord.save();
    return res.message(`Status is Updated`);
  } catch (e) {
    return next(e);
  }
};

/**
 * To change status to given collection
 * Support PUT request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.changeRequest = async (req, res, next) => {
  try {
    let {
      body: { requestStatus, reasonForRejection },
      params: { id: _id },
    } = req;

    const existRecord = await Service.getByData(
      { _id, userType: 'VENDOR' },
      { singleResult: true }
    );
    if (!existRecord) {
      return res.message(`user not found`, 409);
    }

    existRecord.requestStatus = requestStatus;
    if (reasonForRejection && requestStatus === 'REJECTED') {
      existRecord.reasonForRejection = reasonForRejection;
    } else {
      existRecord.reasonForRejection = null;
    }

    await existRecord.save();

    await FoodTruckService.update(
      { userId: _id },
      { inactive: requestStatus !== 'APPROVED' }
    );

    try {
      await CustomNotification.sendStatusNotificationToVendor(
        { _id: existRecord._id },
        requestStatus
      );

      await MailHelper.sendRequestStatusToVendor(
        existRecord,
        requestStatus,
        reasonForRejection || ''
      );
    } catch (e) { }

    return res.message(`Status is Updated`);
  } catch (e) {
    return next(e);
  }
};

/**
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.overview = async (req, res, next) => {
  try {
    return res.data(
      {
        totalVendor: await Service.getVendorCountWithFoodTruck('APPROVED'),
        pendingVendor: await Service.getVendorCountWithFoodTruck('PENDING'),
        rejectedVendor: await Service.getVendorCountWithFoodTruck('REJECTED'),
        totalUser: await Service.getCount({
          inactive: false,
          userType: 'CUSTOMER',
          verified: true,
        }),
        inactiveUser: await Service.getCount({
          inactive: true,
          userType: 'CUSTOMER',
          verified: true,
        }),
      },
      `${entityName} items`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.listFavoriteFT = async (req, res, next) => {
  try {
    let {
      query: { limit = 10, page = 1, lat, long, search },
      user,
    } = req;

    const userLat = parseFloat(lat);
    const userLong = parseFloat(long);

    let { data, total } = await FavoriteFoodTruckService.getWithDetail(
      limit,
      page,
      search,
      user._id
    );

    data = data.map((item) => {
      item.foodTruck.locations = (item.foodTruck.locations || []).map((l) => {
        l.distanceInMeters = 0;
        if (lat !== undefined && long !== undefined && lat >= 0 && long >= 0) {
          l.distanceInMeters = Utils.getDistanceInMeters(
            l.lat,
            l.long,
            userLat,
            userLong
          );
        }
        return l;
      });
      return item;
    });

    return res.data(
      {
        favoriteList: data,
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

exports.addressList = async (req, res, next) => {
  try {
    let {
      query: { limit = 10, page = 1, search },
      params: { id: _id },
      user,
    } = req;
    if (_id) {
      let item = await AddressService.getById(_id);
      return res.data({ address: item }, `address item`);
    }

    let q = {};
    if (search && search.trim()) {
      q = {
        $or: [
          { title: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          { address: { $regex: search.trim().toLowerCase(), $options: 'i' } },
        ],
      };
    }
    const data = await AddressService.getByData(
      { userId: user._id, ...q },
      { paging: { limit, page }, lean: true }
    );

    const total = await Service.getCount({
      userId: user._id,
      ...q,
    });

    return res.data(
      {
        addressList: data,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      `address items`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.addAddress = async (req, res, next) => {
  try {
    let {
      body: { title, address, lat, long },
      user,
    } = req;

    const data = await AddressService.create({
      userId: user._id,
      title,
      address,
      lat,
      long,
    });

    return res.data({ address: data }, `address added`);
  } catch (e) {
    return next(e);
  }
};

/**
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.getBankDetail = async (req, res, next) => {
  try {
    let { user } = req;

    let data = await BankDetailService.getByData(
      { userId: user._id },
      { singleResult: true, lean: true }
    );
    console.log("ddat5a", data);
    if (data) {
      // decrypt bank details before sending to frontend
      data = EncryptionService.decryptFields(data, [
        'accountHolderName',
        'bankName',
        'accountNumber',
        'routingNumber',
        'accountType',
        'remittanceEmail',
        'currency',
        'swiftCode',
        'iban',
        'paymentMethod',
        "bankAddressLine1",
        "bankAddressLine2",
        "bankCity",
        "bankState",
        "bankPostal",
      ]);
    }
    return res.data({ bankDetail: data }, `Bank detail`);
  } catch (e) {
    return next(e);
  }
};

/**
 * Customer: Free dessert progress for profile screen
 * Does not change existing response structures elsewhere
 */
exports.getFreeDessertProgress = async (req, res, next) => {
  try {
    const { user } = req;

    const settings = await SettingService.getByData({}, { singleResult: true });
    const threshold = Number(settings?.freeDessertOrderCount || 0);
    const amount = Number(settings?.freeDessertAmount || 0);
    const enabled = !!settings?.isFreeDessertEnabled;

    const completedOrders = await OrderService.getCount({
      userId: user._id,
      orderStatus: 'COMPLETED',
      deletedAt: null,
    });
    const appliedRedemptions = await OrderService.getCount({
      userId: user._id,
      freeDessertApplied: true,
      deletedAt: null,
    });

    let ordersDoneInCurrentCycle = 0;
    let ordersRemainingInCurrentCycle = 0;
    let currentCycleTarget = threshold;
    let nextEligibleOrderNumber = null;

    if (threshold > 0) {
      ordersDoneInCurrentCycle = completedOrders % threshold;
      ordersRemainingInCurrentCycle = threshold - ordersDoneInCurrentCycle;
      if (ordersRemainingInCurrentCycle === threshold) {
        // Exactly at boundary means 0 done in current cycle
        ordersDoneInCurrentCycle = 0;
        ordersRemainingInCurrentCycle = threshold;
      }
      nextEligibleOrderNumber =
        Math.floor(completedOrders / threshold + 1) * threshold;
    }

    return res.data(
      {
        progress: {
          isFreeDessertEnabled: enabled,
          freeDessertAmount: amount,
          freeDessertOrderCount: threshold,
          userCompletedOrders: completedOrders,
          ordersDoneInCurrentCycle,
          currentCycleTarget,
          ordersRemainingInCurrentCycle,
          nextEligibleOrderNumber,
          totalRedemptionsUsed: appliedRedemptions,
        },
      },
      'Free dessert progress'
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.addBankDetail = async (req, res, next) => {
  try {
    let {
      body: {
        accountHolderName,
        bankName,
        accountNumber,
        routingNumber,
        accountType,
        remittanceEmail,
        currency,
        // swiftCode,
        // iban,
        paymentMethod,
        bankAddressLine1,
        bankAddressLine2,
        bankCity,
        bankState,
        bankPostal,
      },
      user,
    } = req;

    const customError = new Error();
    customError.code = 422;

    if (remittanceEmail) {
      const emailDomain = remittanceEmail.split('@')[1];
      if (disposableDomains.includes(emailDomain)) {
        customError.message = 'Disposable email addresses are not allowed.';
        throw customError;
      }
    }

    const data = await BankDetailService.updateTheDetail(user._id, {
      accountHolderName,
      bankName,
      accountNumber,
      routingNumber,
      accountType,
      remittanceEmail: remittanceEmail ?? null,
      currency,
      // swiftCode:swiftCode ?? null,
      // iban: iban ?? null,
      paymentMethod,
      bankAddressLine1: bankAddressLine1 || "NA",
      bankAddressLine2: bankAddressLine2 || "",
      bankCity: bankCity || "NA",
      bankState: bankState || "NA",
      bankPostal: bankPostal || "NA",
    });

    return res.data({ bankDetail: data }, `Bank detail updated`);
  } catch (e) {
    return next(e);
  }
};

/**
 * Support PUT request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.updateAddress = async (req, res, next) => {
  try {
    let {
      body: { title, address, lat, long },
      params: { id: _id },
      user,
    } = req;

    const item = await AddressService.getByData(
      { userId: user._id, _id },
      { singleResult: true }
    );

    if (!item) {
      return res.error(new Error('Address not found'), 409);
    }

    if (title) {
      item.title = title;
    }

    if (address) {
      item.address = address;
    }

    if (lat) {
      item.lat = lat;
    }

    if (long) {
      item.long = long;
    }

    await item.save();

    return res.data({ address: item }, `address added`);
  } catch (e) {
    return next(e);
  }
};

/**
 * Support PUT request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.deleteAddress = async (req, res, next) => {
  try {
    let {
      params: { id: _id },
      user,
    } = req;

    await AddressService.destroy({ userId: user._id, _id });

    return res.message(`address deleted`);
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.addFavoriteFT = async (req, res, next) => {
  try {
    let {
      params: { id: _id },
      user,
    } = req;

    const existRecord = await FavoriteFoodTruckService.getByData(
      { userId: user._id, foodTruckId: _id },
      { singleResult: true }
    );
    if (existRecord) {
      return res.message(`Already exists`, 409);
    }

    const data = await FavoriteFoodTruckService.create({
      userId: user._id,
      foodTruckId: _id,
    });

    return res.data({ favorite: data }, `favorite added`);
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.removeFavoriteFT = async (req, res, next) => {
  try {
    let {
      params: { id: _id },
      user,
    } = req;

    await FavoriteFoodTruckService.destroy({
      userId: user._id,
      foodTruckId: _id,
    });

    return res.message(`favorite removed`);
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.setFCMToken = async (req, res, next) => {
  try {
    const {
      body: { token, deviceId },
      user,
    } = req;

    const item = await Service.getById(user._id);
    item.fcmTokens = item.fcmTokens || [];

    item.fcmTokens.push({ token, deviceId });

    await item.save();
    const data = item.fcmTokens.pop();
    return res.data({ token: data }, 'Token added');
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.updateFCMToken = async (req, res, next) => {
  try {
    const {
      params: { id: deviceId },
      body: { token },
      user,
    } = req;

    let data = null;
    const item = await Service.getById(user._id);
    item.fcmTokens = (item.fcmTokens || []).map((itm) => {
      if (itm.deviceId.toString() === deviceId) {
        itm.token = token;
        data = itm;
      }
      return itm;
    });

    if (!data) {
      return res.message(`Token item not found`, 409);
    }

    await item.save();
    return res.data({ token: data }, 'Token updated');
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.removeFCMToken = async (req, res, next) => {
  try {
    const {
      params: { id: deviceId },
      user,
    } = req;

    const item = await Service.getById(user._id);
    item.fcmTokens = (item.fcmTokens || []).filter(
      (itm) => itm.deviceId.toString() !== deviceId
    );

    await item.save();
    return res.message('Token removed');
  } catch (e) {
    return next(e);
  }
};

/**
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.sendNotification = async (req, res, next) => {
  try {
    const {
      body: { userList, title, description },
    } = req;

    const users = (await Service.getByData({ _id: { $in: userList } })) || [];

    const noteData = {};

    users.forEach((item) => {
      if (item.fcmTokens?.length) {
        noteData[item._id.toString()] = {
          title,
          body: description,
        };
      }
    });

    await CustomNotification.sendNotificationToUsers(noteData);

    return res.message('sent message');
  } catch (e) {
    return next(e);
  }
};

exports.deleteAccount = async (req, res, next) => {
  try {
    const { user } = req;

    const otpVerificationToken = await MailHelper.sendOTP(
      'delete-account',
      { userId: user._id },
      user.email
    );

    return res.status(200).json({
      code: 200,
      resCode: 'SENT_MAIL',
      success: true,
      data: { otpVerificationToken, sentMail: true },
      error: null,
      message: 'Verification mail has been sent to your given email',
    });

    return res.message('sent message');
  } catch (e) {
    return next(e);
  }
};

/**
 * Admin send notification to all users/vendors/customers
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.adminSendNotification = async (req, res, next) => {
  try {
    const {
      body: { recipientType, title, description },
      user,
    } = req;

    let query = { verified: true, inactive: false };

    if (recipientType === 'ALL_VENDORS') {
      query.userType = 'VENDOR';
      query.requestStatus = 'APPROVED';
    } else if (recipientType === 'ALL_CUSTOMERS') {
      query.userType = 'CUSTOMER';
    } else if (recipientType === 'ALL_USERS') {
      query.userType = { $in: ['VENDOR', 'CUSTOMER'] };
    }

    const users = await Service.getByData(query, { lean: true });

    const noteData = {};
    const recipientIds = [];
    users.forEach((item) => {
      recipientIds.push(item._id);
      if (item.fcmTokens?.length) {
        noteData[item._id.toString()] = {
          title,
          body: description,
        };
      }
    });

    await CustomNotification.sendNotificationToUsers(noteData);

    await AdminNotificationService.create({
      title,
      description,
      recipientType,
      sentBy: user._id,
      sentTo: recipientIds,
    });

    return res.message('Notification sent successfully');
  } catch (e) {
    return next(e);
  }
};

/**
 * Admin get notification list
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.adminNotificationList = async (req, res, next) => {
  try {
    const {
      query: { limit = 10, page = 1, search },
    } = req;

    let query = {};
    if (search && search.trim()) {
      query = {
        $or: [
          { title: { $regex: search.trim(), $options: 'i' } },
          { description: { $regex: search.trim(), $options: 'i' } },
        ],
      };
    }

    const data = await AdminNotificationService.getByData(query, {
      paging: { limit, page },
      lean: true,
      sort: { createdAt: -1 },
      populate: { path: 'sentBy', select: 'firstName lastName email' },
    });

    const total = await AdminNotificationService.getCount(query);
    return res.data(
      {
        notificationList: data,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      'Admin notifications'
    );
  } catch (e) {
    console.log("e,",e);
    return next(e);
  }
};
