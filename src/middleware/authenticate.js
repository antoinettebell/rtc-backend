/**
 * Middleware file to check authentication flow
 */
const jwt = require('jsonwebtoken');
const { JWT } = require('../config');
const { UserModel: Model, VendorEmployeeModel } = require('../models');

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

    if (verifyToken.userType === 'EMPLOYEE' || verifyToken.role === 'EMPLOYEE') {
      const employee = await VendorEmployeeModel.findOne({
        employee_internal_id: verifyToken.employee_internal_id,
        is_active: true,
        is_archived: false,
      }).lean();

      if (!employee) {
        customError.message = 'Employee not Found';
        throw customError;
      }

      req.user = {
        _id: employee._id,
        userType: 'EMPLOYEE',
        role: 'EMPLOYEE',
        employee_internal_id: employee.employee_internal_id,
        employee_session_id: verifyToken.employee_session_id,
        employee_login_id: employee.employee_login_id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        vendor_user_id: employee.vendor_user_id,
        food_truck_id: employee.food_truck_id,
        assigned_location_id: employee.assigned_location_id,
        assigned_truck_unit_id: employee.assigned_truck_unit_id || null,
        is_working: !!employee.is_working,
        authToken: authorization,
      };
      next();
      return;
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
