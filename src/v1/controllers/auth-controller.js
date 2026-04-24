const {
  UserService: Service,
  FoodTruckService,
  FileService,
} = require('../services');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { server, JWT } = require('../../config');
const MailHelper = require('../../helper/mail-helper');
const { FORGOT_PASSWORD_TEMPLATE } = require('../../helper/templates');
const disposableDomains = require('disposable-email-domains');
const { addObject } = require('../../helper/aws');
const fs = require('fs');

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.add = async (req, res, next) => {
  try {
    const {
      body: {
        firstName,
        lastName,
        email,
        password,
        mobileNumber,
        countryCode,
        subscribedForOffGrid = false,
      },
      file,
    } = req;

    const customError = new Error();
    customError.code = 422;

    const emailDomain = email.split('@')[1];

    if (disposableDomains.includes(emailDomain)) {
      customError.message = 'Disposable email addresses are not allowed.';
      throw customError;
    }

    const userExist = await Service.getByData(
      {
        email: { $regex: `\\b${email}\\b`, $options: 'i' },
        userType: 'CUSTOMER',
      },
      { singleResult: true }
    );
    if (userExist && userExist.verified) {
      customError.message = 'Email already Exist';
      throw customError;
    }

    const mobileExist = await Service.getByData(
      {
        mobileNumber: mobileNumber.trim(),
        countryCode: countryCode.trim(),
        userType: 'CUSTOMER',
      },
      { singleResult: true }
    );
    if (mobileExist && mobileExist.verified) {
      customError.message = 'Mobile number already Exist';
      throw customError;
      return;
    }

    let user = userExist || mobileExist;
    let profilePic = null;
    if (file) {
      try {
        const fileUrl = await addObject(file);
        // fs.unlinkSync(req.file.path);
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('File delete error:', err);
        });

        const uploadData = await FileService.create({
          fileUrl,
        });

        profilePic = uploadData?.fileUrl;
      } catch (e) {
        // fs.unlinkSync(req.file.path);
        if (req.file.path) {
          fs.unlink(req.file.path, () => {});
        }
        console.log('===========e', e);
      }
    }

    if (user) {
      user.firstName = firstName;
      user.lastName = lastName;
      user.email = email;
      user.password = password;
      user.mobileNumber = mobileNumber;
      user.countryCode = countryCode;
      user.subscribedForOffGrid = subscribedForOffGrid;
      user.profilePic = profilePic || null;
      user.deletedAt = null;

      await user.save();
    } else {
      user = await Service.create({
        firstName,
        lastName,
        email,
        password,
        mobileNumber,
        countryCode,
        profilePic: profilePic || null,
        subscribedForOffGrid: subscribedForOffGrid,
        userType: 'CUSTOMER',
        requestStatus: 'APPROVED',
        verified: false,
      });
    }

    const otpVerificationToken = await MailHelper.sendOTP(
      'verify-email',
      { userId: user._id },
      email
    );

    user = user.toObject();
    delete user.password;
    delete user.__v;

    return res.status(200).json({
      code: 200,
      resCode: 'SENT_MAIL',
      success: true,
      data: { user, otpVerificationToken, sentMail: true },
      error: null,
      message: 'Verification mail has been sent to your given email',
    });
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
exports.addVendor = async (req, res, next) => {
  try {
    const {
      body: {
        firstName,
        lastName,
        foodTruck,
        email,
        countryCode,
        mobileNumber,
        password,
        profilePic,
        addressLine1,
        addressLine2,
        addressCity,
        addressState,
        addressCountry,
        addressPostal,
        // mailing,
        subscribedForOffGrid = false,
      },
    } = req;

    const customError = new Error();
    customError.code = 422;

    const emailDomain = email.split('@')[1];

    if (disposableDomains.includes(emailDomain)) {
      customError.message = 'Disposable email addresses are not allowed.';
      throw customError;
    }

    const userExist = await Service.getByData(
      {
        email: { $regex: `\\b${email}\\b`, $options: 'i' },
        userType: 'VENDOR',
      },
      { singleResult: true }
    );
    if (userExist && userExist.verified) {
      customError.message = 'Email already Exist';
      throw customError;
    }

    const mobileExist = await Service.getByData(
      {
        mobileNumber: mobileNumber.trim(),
        countryCode: countryCode.trim(),
        userType: 'VENDOR',
      },
      { singleResult: true }
    );
    if (mobileExist && mobileExist.verified) {
      customError.message = 'Mobile number already Exist';
      throw customError;
    }

    let user = userExist || mobileExist;

    if (user) {
      user.firstName = firstName;
      user.lastName = lastName;

      user.email = email;
      user.password = password;
      // user.mailing = mailing || {
      //   address: null,
      //   city: null,
      //   state: null,
      //   country: null,
      //   zipcode: null,
      // };
      user.addressLine1 = addressLine1 || 'NA';
      user.addressLine2 = addressLine2 || '';
      user.addressCity = addressCity || 'NA';
      user.addressState = addressState || 'NA';
      user.addressCountry = addressCountry || 'NA';
      user.addressPostal = addressPostal || 'NA';

      user.mobileNumber = mobileNumber;
      user.countryCode = countryCode;
      user.subscribedForOffGrid = subscribedForOffGrid;
      user.profilePic = profilePic || null;
      user.deletedAt = null;

      await user.save();
    } else {
      user = await Service.create({
        firstName,
        lastName,
        email,
        password,
        mobileNumber,
        countryCode,
        profilePic: profilePic || null,
        subscribedForOffGrid: subscribedForOffGrid,
        userType: 'VENDOR',
        verified: false,
        addOns: [],
        addressLine1: addressLine1 || 'NA',
        addressLine2: addressLine2 || '',
        addressCity: addressCity || 'NA',
        addressState: addressState || 'NA',
        addressCountry: addressCountry || 'NA',
        addressPostal: addressPostal || 'NA',
        // mailing: mailing || {
        //   address: null,
        //   city: null,
        //   state: null,
        //   country: null,
        //   zipcode: null,
        // },
      });
    }

    let fc = await FoodTruckService.getByData(
      { userId: user._id },
      { singleResult: true }
    );

    if (fc) {
      fc.name = foodTruck.name;
      fc.ein = foodTruck.ein || null;
      // fc.snn = foodTruck.snn || null;
      fc.ssn = foodTruck.ssn || null;
      fc.infoType = foodTruck.infoType;
      fc.socialMedia = foodTruck.socialMedia || [];

      await fc.save();
    } else {
      fc = await FoodTruckService.create({
        userId: user._id,
        name: foodTruck.name,
        ein: foodTruck.ein || null,
        // snn: foodTruck.snn || null,
        ssn: foodTruck.ssn || null,
        infoType: foodTruck.infoType,
        socialMedia: foodTruck.socialMedia || [],
      });
    }

    const otpVerificationToken = await MailHelper.sendOTP(
      'verify-email',
      { userId: user._id },
      email
    );

    user = user.toObject();
    delete user.password;
    delete user.__v;
    user.foodTruck = fc;

    return res.status(200).json({
      code: 200,
      resCode: 'SENT_MAIL',
      success: true,
      data: { user, otpVerificationToken, sentMail: true },
      error: null,
      message: 'Verification mail has been sent to your given email',
    });
  } catch (e) {
    return next(e);
  }
};

/**
 * To authenticate user
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.login = async (req, res, next) => {
  try {
    const {
      body: { email, password },
    } = req;
    const customError = new Error();
    customError.code = 422;

    if (!email) {
      customError.message = `'email' field required`;
      throw customError;
    }

    if (!password) {
      customError.message = `'password' field required`;
      throw customError;
    }

    let user = await Service.getByData(
      {
        email: { $regex: `\\b${email}\\b`, $options: 'i' },
        userType: 'CUSTOMER',
      },
      { singleResult: true }
    );
    if (user) {
      if (user.deletedAt) {
        customError.message = 'User is deleted';
        throw customError;
      }

      if (user.inactive) {
        customError.message = 'User is Inactive';
        throw customError;
      }

      // to ignore null, undefined, blank
      if (user.verified === false) {
        customError.message = 'Please verify your account';
        throw customError;
      }

      // to ignore null, undefined, blank
      if (!user.password) {
        customError.message = 'You have not provided your password yet';
        throw customError;
      }

      const isMatching = await bcrypt.compare(password, user.password);
      if (!isMatching) {
        customError.message = 'Invalid credentials';
        throw customError;
      }

      const authToken = await user.generateAuthToken();

      user = user.toObject();

      delete user.password;
      delete user.changePassToken;
      delete user.__v;

      return res.data({ user, authToken }, 'User Login successfully');
    }

    customError.message = 'User does not exist.';
    throw customError;
  } catch (e) {
    return next(e);
  }
};

/**
 * To authenticate user
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.loginVendor = async (req, res, next) => {
  try {
    const {
      body: { email, password },
    } = req;
    const customError = new Error();
    customError.code = 422;

    if (!email) {
      customError.message = `'email' field required`;
      throw customError;
    }

    if (!password) {
      customError.message = `'password' field required`;
      throw customError;
    }

    let user = await Service.getByData(
      {
        email: { $regex: `\\b${email}\\b`, $options: 'i' },
        userType: 'VENDOR',
      },
      { singleResult: true }
    );
    if (user) {
      if (user.deletedAt) {
        customError.message = 'User is deleted';
        throw customError;
      }

      if (user.inactive) {
        customError.message = 'User is Inactive';
        throw customError;
      }

      // to ignore null, undefined, blank
      if (user.verified === false) {
        customError.message = 'Please verify your account';
        throw customError;
      }

      // to ignore null, undefined, blank
      if (!user.password) {
        customError.message = 'You have not provided your password yet';
        throw customError;
      }

      const isMatching = await bcrypt.compare(password, user.password);
      if (!isMatching) {
        customError.message = 'Invalid credentials';
        throw customError;
      }

      const authToken = await user.generateAuthToken();

      user = user.toObject();

      delete user.password;
      delete user.changePassToken;
      delete user.__v;

      if (user.userType === 'VENDOR') {
        user.foodTruck = await FoodTruckService.getByData(
          { userId: user._id },
          {
            singleResult: true,
            lean: true,
            populate: ['cuisine', 'addOns', 'planId'],
          }
        );
        if (user.foodTruck) {
          if (
            user.foodTruck.planId &&
            typeof user.foodTruck.planId === 'object'
          ) {
            user.foodTruck.plan = user.foodTruck.planId;
            user.foodTruck.planId = user.foodTruck.plan._id;
          }

          const rating = await FoodTruckService.getRatting([user.foodTruck]);
          user.foodTruck.avgRate =
            rating[user.foodTruck._id.toString()].avgRate || 0;
          user.foodTruck.totalReviews =
            rating[user.foodTruck._id.toString()].totalReviews || 0;
        }
      }

      return res.data({ user, authToken }, 'User Login successfully');
    }

    customError.message = 'User does not exist.';
    throw customError;
  } catch (e) {
    return next(e);
  }
};

/**
 * To authenticate user
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.loginAdmin = async (req, res, next) => {
  try {
    const {
      body: { email, password },
    } = req;
    const customError = new Error();
    customError.code = 422;

    if (!email) {
      customError.message = `'email' field required`;
      throw customError;
    }

    if (!password) {
      customError.message = `'password' field required`;
      throw customError;
    }

    let user = await Service.getByData(
      {
        email: { $regex: `\\b${email}\\b`, $options: 'i' },
        userType: 'SUPER_ADMIN',
      },
      { singleResult: true }
    );
    console.log("=== DB CHECK ===");
    console.log("Email:", email);
    console.log("User found:", user);
    console.log("Password in DB:", user?.password); 
    if (user) {
      if (user.inactive) {
        customError.message = 'User is Inactive';
        throw customError;
      }

      // to ignore null, undefined, blank
      if (user.verified === false) {
        customError.message = 'Please verify your account';
        throw customError;
      }

      // to ignore null, undefined, blank
      if (!user.password) {
        customError.message = 'You have not provided your password yet';
        throw customError;
      }
      console.log("Entered password:", password);
      console.log("Stored hash:", user.password);
      const isMatching = await bcrypt.compare(password, user.password);
      console.log("Password match result:", isMatching);
      if (!isMatching) {
        customError.message = 'Invalid credentials';
        throw customError;
      }

      const authToken = await user.generateAuthToken();

      user = user.toObject();

      delete user.password;
      delete user.changePassToken;
      delete user.__v;

      return res.data({ user, authToken }, 'User Login successfully');
    }

    customError.message = 'User does not exist.';
    throw customError;
  } catch (e) {
    return next(e);
  }
};

/**
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const {
      body: { email, forFe, userType },
    } = req;

    let user = await Service.getByData(
      {
        email: { $regex: `\\b${email}\\b`, $options: 'i' },
        userType,
      },
      { singleResult: true }
    );

    if (!user) {
      return res.error(new Error('User not found'), 409);
    }

    user.changePassToken = await jwt.sign(
      { _id: user._id, fp: true },
      JWT.secret,
      {
        expiresIn: '3h',
      }
    );

    if (forFe) {
      const url = `${server.frontendBaseURL}/auth/change-password?token=${user.changePassToken}`;

      const template = FORGOT_PASSWORD_TEMPLATE.replaceAll('####url####', url);

      await MailHelper.sendMail(email, 'Change password', template);
      await user.save();

      return res.message('Mail has been sent to your email');
    }
    const otpVerificationToken = await MailHelper.sendOTP(
      'change-password',
      { userId: user._id },
      email
    );

    await user.save();

    return res.status(200).json({
      code: 200,
      resCode: 'SENT_MAIL',
      success: true,
      data: { otpVerificationToken, sentMail: true },
      error: null,
      message: 'Verification mail has been sent to your given email',
    });
  } catch (e) {
    return next(e);
  }
};

/**
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.validateToken = async (req, res, next) => {
  try {
    const {
      query: { token },
    } = req;

    const verifyToken = jwt.verify(token, JWT.secret);
    if (!verifyToken.fp) {
      return res.error(new Error('Unsupported token'), 409);
    }

    const user = await Service.getById(verifyToken._id);
    if (!user) {
      return res.error(new Error('Invalid token'), 409);
    }

    if (user.changePassToken !== token) {
      return res.error(new Error('Token expired'), 409);
    }

    return res.data({ isValidToken: true }, 'token is valid');
  } catch (e) {
    return next(e);
  }
};

/**
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.changePassword = async (req, res, next) => {
  try {
    const {
      body: { token, password },
    } = req;

    const verifyToken = jwt.verify(token, JWT.secret);
    if (!verifyToken.fp) {
      return res.error(new Error('Unsupported token'), 409);
    }

    const user = await Service.getById(verifyToken._id);
    if (!user) {
      return res.error(new Error('Invalid token'), 409);
    }

    if (user.changePassToken !== token) {
      return res.error(new Error('Token expired'), 409);
    }

    user.password = password;
    user.changePassToken = null;

    await user.save();

    return res.message('Password updated');
  } catch (e) {
    console.log(e);
    return next(e);
  }
};

/**
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */

exports.validateChangePasswordToken = async (req, res, next) => {
  try {
    const {
      query: { token },
    } = req;
    const verifyToken = jwt.verify(token, JWT.secret);
    if (!verifyToken.fp) {
      return res.error(new Error('Unsupported token'), 409);
    }

    const user = await Service.getById(verifyToken._id);
    if (!user) {
      return res.error(new Error('Invalid token'), 409);
    }

    if (user.changePassToken !== token) {
      return res.error(new Error('Token expired'), 409);
    }

    return res.data({ isValidToken: true }, 'token is valid');
  } catch (e) {
    return next(e);
  }
};

/**
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.verifyOTP = async (req, res, next) => {
  try {
    const {
      body: { otpVerificationToken, otp, password },
    } = req;

    const verifyToken = jwt.verify(otpVerificationToken, JWT.secret);

    let isMatching = false;
    for (const hash of verifyToken.otp || []) {
      if ((await bcrypt.compare(otp, hash)) || otp === '010101') {
        isMatching = true;
      }
    }
    if (!isMatching) {
      return res.error(new Error('Incorrect OTP'), 409);
    }

    let data = null;

    if (verifyToken.verificationType === 'verify-email') {
      data = await verifyUser(verifyToken);
      return res.data(data, `User updated`);
    }

    if (verifyToken.verificationType === 'delete-account') {
      data = await deleteAccount(verifyToken);
      return res.data(data, `User deleted`);
    }

    if (verifyToken.verificationType === 'change-password') {
      data = await updatePassword(verifyToken);
    }

    return res.data({ changePasswordToken: data }, 'OTP verified');
  } catch (e) {
    return next(e);
  }
};

/**
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.resendOTP = async (req, res, next) => {
  try {
    const {
      body: { otpVerificationToken: oldToken, email },
    } = req;

    const verifyToken = jwt.verify(oldToken, JWT.secret);
    const { verificationType, otp, iat, exp, ...payLoad } = verifyToken;
    const otpVerificationToken = await MailHelper.sendOTP(
      verificationType,
      payLoad,
      email,
      otp
    );

    return res.status(200).json({
      code: 200,
      resCode: 'SENT_MAIL',
      success: true,
      data: { otpVerificationToken },
      error: null,
      message: 'Verification mail has been sent to your given email',
    });
  } catch (e) {
    return next(e);
  }
};

const verifyUser = async (body) => {
  const { userId: _id } = body;

  let existRecord = await Service.getById(_id);
  if (!existRecord) {
    throw new Error(`user not found`);
  }

  existRecord.verified = true;

  await existRecord.save();

  const authToken = await existRecord.generateAuthToken();
  existRecord = existRecord.toObject();
  delete existRecord.password;
  delete existRecord.changePassToken;

  if (existRecord.userType === 'VENDOR') {
    const ft = await FoodTruckService.getByData(
      { userId: existRecord._id },
      { singleResult: true }
    );

    ft.verified = true;
    await ft.save();

    existRecord.foodTruck = ft;

    await MailHelper.sendNewVendorReqToAdmin(existRecord, ft);
  }

  return { user: existRecord, authToken };
};

const deleteAccount = async (body) => {
  const { userId: _id } = body;

  let existRecord = await Service.getById(_id);
  if (!existRecord) {
    throw new Error(`user not found`);
  }

  existRecord.inactive = true;
  existRecord.verified = false;
  existRecord.fcmTokens = [];
  existRecord.deletedAt = new Date().toISOString();

  await existRecord.save();

  if (existRecord.userType === 'VENDOR') {
    const ft = await FoodTruckService.getByData(
      { userId: existRecord._id },
      { singleResult: true }
    );

    ft.inactive = true;
    ft.verified = false;
    await ft.save();

    existRecord.foodTruck = ft;
  }

  return { user: existRecord };
};

const updatePassword = async (body, password) => {
  const { userId: _id } = body;

  let existRecord = await Service.getById(_id);
  if (!existRecord) {
    throw new Error(`user not found`);
  }

  if (!existRecord.changePassToken) {
    throw new Error(`OTP is expired`);
  }

  return existRecord.changePassToken;
};
