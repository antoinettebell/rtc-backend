const {
  VendorEmployeeService: Service,
  EmployeeSessionService,
  EmployeeRefundCancelRequestService,
} = require('../services');
const {
  assertVendorPlanCapability,
} = require('../../helper/vendor-plan-helper');
const { PlanService } = require('../services');
const { JWT } = require('../../config');
const jwt = require('jsonwebtoken');

const entityName = 'VendorEmployee';

const getEmployeePlan = async (foodTruck) =>
  foodTruck?.planId ? PlanService.getById(foodTruck.planId) : null;

const assertEmployeeManagementAllowed = async (foodTruck) => {
  const plan = await getEmployeePlan(foodTruck);
  assertVendorPlanCapability(
    plan,
    'employeeLogin',
    'Your current vendor plan does not include employee management.'
  );
};

exports.list = async (req, res, next) => {
  try {
    const {
      query: { includeArchived = false },
      user,
    } = req;

    const foodTruck = await Service.getVendorFoodTruckByUser(user._id);
    await assertEmployeeManagementAllowed(foodTruck);

    const q = {
      vendor_user_id: user._id,
    };

    if (!includeArchived) {
      q.is_archived = false;
    }

    const data = await Service.getByData(q, {
      sort: { created_at: -1 },
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}List`]: data },
      `${entityName} items`
    );
  } catch (e) {
    return next(e);
  }
};

exports.add = async (req, res, next) => {
  try {
    const {
      body: {
        food_truck_id,
        assigned_location_id,
        first_name,
        last_name,
        zip_code,
        pin,
        is_active,
        is_working,
      },
      user,
    } = req;

    const foodTruck = await Service.getVendorFoodTruck(user._id, food_truck_id);
    await assertEmployeeManagementAllowed(foodTruck);

    const employee = await Service.createForVendor({
      vendor_user_id: user._id,
      food_truck_id,
      assigned_location_id,
      first_name,
      last_name,
      zip_code,
      pin,
      is_active,
      is_working,
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: employee },
      `${entityName} added`
    );
  } catch (e) {
    return next(e);
  }
};

exports.update = async (req, res, next) => {
  try {
    const {
      params: { id },
      body,
      user,
    } = req;

    const employee = await Service.getScopedEmployee({
      vendor_user_id: user._id,
      employee_id: id,
    });
    const foodTruck = await Service.getVendorFoodTruck(
      user._id,
      employee.food_truck_id
    );
    await assertEmployeeManagementAllowed(foodTruck);

    const updated = await Service.updateForVendor({
      vendor_user_id: user._id,
      employee_id: id,
      update: body,
    });

    if (body.is_working === false || body.is_active === false) {
      await EmployeeSessionService.endActiveSessions(
        updated.employee_internal_id
      );
    }

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: updated },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

exports.resetPin = async (req, res, next) => {
  try {
    const {
      params: { id },
      body: { pin },
      user,
    } = req;

    const employee = await Service.getScopedEmployee({
      vendor_user_id: user._id,
      employee_id: id,
    });
    const foodTruck = await Service.getVendorFoodTruck(
      user._id,
      employee.food_truck_id
    );
    await assertEmployeeManagementAllowed(foodTruck);

    const updated = await Service.resetPinForVendor({
      vendor_user_id: user._id,
      employee_id: id,
      pin,
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: updated },
      `${entityName} PIN reset`
    );
  } catch (e) {
    return next(e);
  }
};

exports.archive = async (req, res, next) => {
  try {
    const {
      params: { id },
      user,
    } = req;

    const employee = await Service.getScopedEmployee({
      vendor_user_id: user._id,
      employee_id: id,
    });
    const foodTruck = await Service.getVendorFoodTruck(
      user._id,
      employee.food_truck_id
    );
    await assertEmployeeManagementAllowed(foodTruck);

    const archived = await Service.archiveForVendor({
      vendor_user_id: user._id,
      employee_id: id,
    });
    await EmployeeSessionService.endActiveSessions(
      archived.employee_internal_id
    );

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: archived },
      `${entityName} archived`
    );
  } catch (e) {
    return next(e);
  }
};

exports.endSession = async (req, res, next) => {
  try {
    const { user } = req;
    const employeeSession = await EmployeeSessionService.endSession({
      employeeSessionId: user.employee_session_id,
      employeeInternalId: user.employee_internal_id,
    });

    return res.data({ employeeSession }, 'Employee session ended');
  } catch (e) {
    return next(e);
  }
};

exports.toggleDuty = async (req, res, next) => {
  try {
    const { user, body } = req;
    const isWorking = !!body.is_working;
    const employee = await Service.getScopedEmployee({
      vendor_user_id: user.vendor_user_id,
      employee_id: user._id,
    });

    if (!employee.is_active || employee.is_archived) {
      return res.error(new Error('Employee is not active'), 403);
    }

    const foodTruck = await Service.getVendorFoodTruck(
      user.vendor_user_id,
      employee.food_truck_id
    );
    await assertEmployeeManagementAllowed(foodTruck);

    const assignedLocation = Service.getAssignedLocation(
      foodTruck,
      employee.assigned_location_id
    );
    if (!assignedLocation) {
      return res.error(
        new Error('Employee assigned location is unavailable'),
        404
      );
    }

    employee.is_working = isWorking;
    await employee.save();

    if (!isWorking) {
      const employeeSession = await EmployeeSessionService.endSession({
        employeeSessionId: user.employee_session_id,
        employeeInternalId: user.employee_internal_id,
      });

      return res.data(
        {
          employee: {
            ...employee.toObject(),
            pin_hash: undefined,
            employee_session_id: null,
          },
          employeeSession,
          assignedLocation,
          authToken: null,
        },
        'Employee is off duty'
      );
    }

    const employeeSession =
      await EmployeeSessionService.startSessionForEmployee({
        employee,
        foodTruck,
        assignedLocation,
      });

    const authToken = jwt.sign(
      {
        _id: employee._id,
        userType: 'EMPLOYEE',
        role: 'EMPLOYEE',
        employee_internal_id: employee.employee_internal_id,
        employee_session_id: employeeSession.employee_session_id,
        vendor_user_id: employee.vendor_user_id,
        food_truck_id: employee.food_truck_id,
        assigned_location_id: employee.assigned_location_id,
      },
      JWT.secret,
      { expiresIn: '168h' }
    );

    return res.data(
      {
        employee: {
          ...employee.toObject(),
          pin_hash: undefined,
          employee_session_id: employeeSession.employee_session_id,
        },
        employeeSession,
        assignedLocation,
        authToken,
      },
      'Employee is working'
    );
  } catch (e) {
    return next(e);
  }
};

exports.dashboard = async (req, res, next) => {
  try {
    const { user } = req;
    const foodTruck = await Service.getVendorFoodTruck(
      user.vendor_user_id,
      user.food_truck_id
    );
    const assignedLocation = Service.getAssignedLocation(
      foodTruck,
      user.assigned_location_id
    );

    if (!assignedLocation) {
      return res.error(
        new Error('Employee assigned location is unavailable'),
        404
      );
    }

    const dashboard = await EmployeeSessionService.getEmployeeDashboard({
      user,
      foodTruck,
      assignedLocation,
    });

    return res.data({ dashboard }, 'Employee dashboard');
  } catch (e) {
    return next(e);
  }
};

exports.submitRefundCancelRequest = async (req, res, next) => {
  try {
    const { user, body } = req;
    await EmployeeSessionService.touchSession(
      user.employee_session_id,
      user.employee_internal_id
    );
    const result = await EmployeeRefundCancelRequestService.submitForEmployee({
      user,
      ...body,
    });

    return res.data(
      {
        request: result.request,
        existing: result.existing,
      },
      result.existing
        ? 'Existing refund/cancel request returned'
        : 'Refund/cancel request submitted'
    );
  } catch (e) {
    return next(e);
  }
};

exports.listRefundCancelRequests = async (req, res, next) => {
  try {
    const { user, query } = req;

    if (user.userType === 'EMPLOYEE') {
      const requests = await EmployeeRefundCancelRequestService.listForEmployee(
        {
          user,
          orderId: query.orderId,
        }
      );
      return res.data({ requests }, 'Employee refund/cancel requests');
    }

    const requests = await EmployeeRefundCancelRequestService.listForVendor({
      vendorUserId: user._id,
      foodTruckId: query.foodTruckId,
      status: query.status,
      employeeInternalId: query.employeeInternalId,
      locationId: query.locationId,
      limit: query.limit,
    });
    return res.data({ requests }, 'Vendor refund/cancel requests');
  } catch (e) {
    return next(e);
  }
};

exports.reviewRefundCancelRequest = async (req, res, next) => {
  try {
    const {
      params: { requestId },
      body,
      user,
    } = req;

    const result = await EmployeeRefundCancelRequestService.reviewForVendor({
      vendorUserId: user._id,
      requestId,
      ...body,
    });

    return res.data(result, 'Refund/cancel request reviewed');
  } catch (e) {
    return next(e);
  }
};
