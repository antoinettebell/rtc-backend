/**
 * Middleware file to check authentication flow
 */
const jwt = require('jsonwebtoken');
const { JWT } = require('../config');
const { UserModel: Model } = require('../models');

const IGNORE_ROUTES = [
  '/public/food-truck-filter',
  '/public/food-truck-filter-new',
  '/public/food-truck/',
  '/public/coupon-validate',
  '/public/global-search',
];

/**
 * To check if requester is authenticated or not with some validation
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 * @constructor
 */
const Authenticate = async (req, res, next) => {
  try {
    const canIgnore = !!IGNORE_ROUTES.find((item) =>
      req.originalUrl.includes(item)
    );

    const customError = new Error();
    customError.code = 401;
    const { authorization } = req.headers;
    if (!authorization) {
      if (canIgnore) {
        next();
        return;
      }
      customError.message = 'Unauthorized';
      throw customError;
    }

    if (!authorization.trim()) {
      customError.message = 'Bad format for authorization';
      throw customError;
    }
    const verifyToken = jwt.verify(authorization, JWT.secret);

    if (!verifyToken.userType) {
      customError.message = 'Invalid token';
      throw customError;
    }

    const rootUser = await Model.findOne({ _id: verifyToken._id }).lean();

    if (!rootUser) {
      customError.message = 'User not Found';
      throw customError;
    }
    rootUser.authToken = authorization;
    delete rootUser.password;
    delete rootUser.__v;
    req.user = rootUser;
    next();
  } catch (err) {
    if (
      err instanceof jwt.TokenExpiredError ||
      err instanceof jwt.JsonWebTokenError
    ) {
      err.code = 401;
    }
    return res.error(err);
  }
};

module.exports = Authenticate;
