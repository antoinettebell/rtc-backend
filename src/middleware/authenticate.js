/**
 * Middleware file to check authentication flow
 */
const jwt = require('jsonwebtoken');
const { JWT } = require('../config');
const {
  UserModel: Model,
  VendorEmployeeModel,
  EmployeeSessionModel,
} = require('../models');
const { FoodTruckModel } = require('../models');
const { getEmployeeScheduleState, getEmployeeScheduleAssignment } = require('../helper/employee-weekly-schedule');
const EmployeeSessionService = require('../v1/services/employee-session-service');

const EMPLOYEE_SHIFT_EXEMPT_ROUTES = [
  '/vendor-employee/dashboard',
  '/vendor-employee/session/action',
  '/vendor-employee/session/end',
];

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

      let activeSession = await EmployeeSessionModel.findOne({
        employee_internal_id: employee.employee_internal_id,
        food_truck_id: employee.food_truck_id,
        is_active: true,
        shift_status: { $in: ['STARTED', 'ON_BREAK'] },
      }).sort({ started_at: -1 }).lean();
      if (activeSession && !activeSession.is_vendor_override && (employee.schedule_assignments?.length || employee.weekly_schedule?.length)) {
        const foodTruck = await FoodTruckModel.findById(employee.food_truck_id).select('schedule_time_zone').lean();
        const scheduleState = employee.schedule_assignments?.length
          ? getEmployeeScheduleAssignment(employee.schedule_assignments, new Date(), foodTruck?.schedule_time_zone || 'America/New_York') || { withinWindow: false }
          : getEmployeeScheduleState(employee.weekly_schedule, new Date(), foodTruck?.schedule_time_zone || 'America/New_York');
        if (!scheduleState.withinWindow) {
          await EmployeeSessionService.endSession({ employeeSessionId: activeSession.employee_session_id, employeeInternalId: employee.employee_internal_id });
          await VendorEmployeeModel.updateOne({ _id: employee._id }, { $set: { is_working: false } });
          activeSession = null;
        }
      }
      const isShiftExempt = EMPLOYEE_SHIFT_EXEMPT_ROUTES.some((route) =>
        req.originalUrl.includes(route)
      );
      if (!employee.is_working && !isShiftExempt) {
        customError.code = 403;
        customError.message = 'You are outside your scheduled working window. Please see your manager.';
        throw customError;
      }
      if (
        activeSession?.shift_status === 'ON_BREAK' &&
        !isShiftExempt
      ) {
        customError.code = 403;
        customError.message =
          'Your shift is paused for break. Please resume your shift to log back in.';
        throw customError;
      }
      if (!activeSession && !isShiftExempt) {
        customError.code = 403;
        customError.message =
          'Your shift has ended. Please see your manager to be clocked back in.';
        throw customError;
      }

      req.user = {
        _id: employee._id,
        userType: 'EMPLOYEE',
        role: 'EMPLOYEE',
        employee_internal_id: employee.employee_internal_id,
        employee_session_id: activeSession?.employee_session_id || null,
        employee_login_id: employee.employee_login_id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        phone_number: employee.phone_number || null,
        address_line1: employee.address_line1 || null,
        address_city: employee.address_city || null,
        address_state: employee.address_state || null,
        zip_code: employee.zip_code || null,
        employee_rate: employee.employee_rate ?? null,
        vendor_user_id: employee.vendor_user_id,
        food_truck_id: employee.food_truck_id,
        assigned_location_id: employee.assigned_location_id,
        assigned_truck_unit_id: employee.assigned_truck_unit_id || null,
        is_working: !!employee.is_working,
        is_shift_active: !!activeSession,
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
