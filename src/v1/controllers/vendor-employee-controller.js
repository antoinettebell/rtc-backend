const {
  VendorEmployeeService: Service,
  EmployeeSessionService,
  EmployeeRefundCancelRequestService,
} = require('../services');
const {
  assertVendorPlanCapability,
} = require('../../helper/vendor-plan-helper');
const { PlanService } = require('../services');
const MailHelper = require('../../helper/mail-helper');
const { JWT } = require('../../config');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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

const buildTempPin = () => String(crypto.randomInt(1000, 10000));

const sendAdminPinResetEmail = async ({
  vendor,
  employee,
  temporaryPin,
  resetUrl,
}) => {
  const link =
    resetUrl ||
    'https://roundthecorner.com/vendor/employees';
  const employeeName = [employee.first_name, employee.last_name]
    .filter(Boolean)
    .join(' ');
  const html = `
    <p>An admin reset the PIN for ${employeeName || 'an employee'}.</p>
    <p>Temporary PIN: <strong>${temporaryPin}</strong></p>
    <p>Manage employee access here: <a href="${link}">${link}</a></p>
    <p>If you did not request this reset, update the employee PIN immediately.</p>
  `;

  await MailHelper.sendMail(
    vendor.email,
    'Employee PIN reset',
    html
  );
};

exports.list = async (req, res, next) => {
  try {
    const {
      query: {
        includeArchived = false,
        archivedOnly = false,
        foodTruckId = null,
      },
      user,
    } = req;

    const foodTruck = await Service.getVendorFoodTruckByUser(user._id);
    await assertEmployeeManagementAllowed(foodTruck);

    const data = await Service.listForVendor({
      vendor_user_id: user._id,
      food_truck_id: foodTruckId,
      includeArchived,
      archivedOnly,
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
	        assigned_truck_unit_id,
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
	      assigned_truck_unit_id,
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
      includeArchived: true,
    });
    const assignedLocationChanged =
      (body.assigned_location_id &&
        employee.assigned_location_id?.toString() !==
          body.assigned_location_id?.toString()) ||
      (body.assigned_truck_unit_id &&
        employee.assigned_truck_unit_id?.toString() !==
          body.assigned_truck_unit_id?.toString());
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

    if (
      body.is_working === false ||
      body.is_active === false ||
      assignedLocationChanged
    ) {
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
      includeArchived: true,
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
      includeArchived: true,
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

exports.remove = async (req, res, next) => {
  try {
    const {
      params: { id },
      user,
    } = req;

    const employee = await Service.getScopedEmployee({
      vendor_user_id: user._id,
      employee_id: id,
      includeArchived: true,
    });
    const foodTruck = await Service.getVendorFoodTruck(
      user._id,
      employee.food_truck_id
    );
    await assertEmployeeManagementAllowed(foodTruck);

    const deleted = await Service.deleteForVendor({
      vendor_user_id: user._id,
      employee_id: id,
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: deleted },
      `${entityName} deleted`
    );
  } catch (e) {
    return next(e);
  }
};

exports.adminList = async (req, res, next) => {
  try {
    const {
      query: {
        vendorUserId,
        foodTruckId = null,
        includeArchived = false,
        archivedOnly = false,
      },
    } = req;

    const foodTruck = foodTruckId
      ? await Service.getVendorFoodTruck(vendorUserId, foodTruckId)
      : await Service.getVendorFoodTruckByUser(vendorUserId);
    const data = await Service.listForVendor({
      vendor_user_id: vendorUserId,
      food_truck_id: foodTruck?._id,
      includeArchived,
      archivedOnly,
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}List`]: data },
      `${entityName} items`
    );
  } catch (e) {
    return next(e);
  }
};

exports.adminAdd = async (req, res, next) => {
  try {
    const {
      body: {
        vendor_user_id,
        food_truck_id,
        assigned_location_id,
        first_name,
        last_name,
        zip_code,
        pin,
        is_active,
        is_working,
      },
    } = req;

    const employee = await Service.createForVendor({
      vendor_user_id,
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

exports.adminUpdate = async (req, res, next) => {
  try {
    const {
      params: { id },
      body,
    } = req;

    const employee = await Service.getByData(
      { _id: id, is_archived: false },
      { singleResult: true }
    );
    if (!employee) {
      return res.error(new Error('Employee not found.'), 404);
    }
    const updated = await Service.updateForVendor({
      vendor_user_id: employee.vendor_user_id,
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

exports.adminResetPin = async (req, res, next) => {
  try {
    const {
      params: { id },
      body: { resetUrl },
    } = req;

    const employee = await Service.getByData(
      { _id: id },
      { singleResult: true }
    );
    if (!employee) {
      return res.error(new Error('Employee not found.'), 404);
    }

    const vendor = await Service.getVendorUser(employee.vendor_user_id);
    const temporaryPin = buildTempPin();
    const updated = await Service.resetPinForVendor({
      vendor_user_id: employee.vendor_user_id,
      employee_id: id,
      pin: temporaryPin,
      includeArchived: true,
    });
    await sendAdminPinResetEmail({
      vendor,
      employee: updated,
      temporaryPin,
      resetUrl,
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: updated },
      `${entityName} PIN reset email sent`
    );
  } catch (e) {
    return next(e);
  }
};

exports.adminArchive = async (req, res, next) => {
  try {
    const {
      params: { id },
    } = req;

    const employee = await Service.getByData(
      { _id: id },
      { singleResult: true }
    );
    if (!employee) {
      return res.error(new Error('Employee not found.'), 404);
    }

    const archived = await Service.archiveForVendor({
      vendor_user_id: employee.vendor_user_id,
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

exports.adminRemove = async (req, res, next) => {
  try {
    const {
      params: { id },
    } = req;

    const employee = await Service.getByData(
      { _id: id },
      { singleResult: true }
    );
    if (!employee) {
      return res.error(new Error('Employee not found.'), 404);
    }

    const deleted = await Service.deleteForVendor({
      vendor_user_id: employee.vendor_user_id,
      employee_id: id,
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: deleted },
      `${entityName} deleted`
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

const assertEmployeeCanUseShift = async (user) => {
  const employee = await Service.getScopedEmployee({
    vendor_user_id: user.vendor_user_id,
    employee_id: user._id,
  });

  if (!employee.is_active || employee.is_archived) {
    const error = new Error('Employee is not active');
    error.code = 403;
    throw error;
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
  const assignedTruckUnit = Service.getAssignedTruckUnit(
    foodTruck,
    employee.assigned_truck_unit_id
  );
  if (!assignedLocation) {
    const error = new Error('Employee assigned location is unavailable');
    error.code = 404;
    throw error;
  }

  return { employee, foodTruck, assignedLocation, assignedTruckUnit };
};

exports.toggleDuty = async (req, res, next) => {
  try {
    const { user, body } = req;
    const isWorking = !!body.is_working;
    const { employee, foodTruck, assignedLocation, assignedTruckUnit } =
      await assertEmployeeCanUseShift(user);

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
          assignedTruckUnit,
          authToken: null,
        },
        'Employee is off duty'
      );
    }

    const authToken = jwt.sign(
      {
        _id: employee._id,
        userType: 'EMPLOYEE',
        role: 'EMPLOYEE',
        employee_internal_id: employee.employee_internal_id,
        employee_session_id: user.employee_session_id || null,
        vendor_user_id: employee.vendor_user_id,
        food_truck_id: employee.food_truck_id,
        assigned_location_id: employee.assigned_location_id,
        assigned_truck_unit_id: employee.assigned_truck_unit_id || null,
      },
      JWT.secret,
      { expiresIn: '168h' }
    );

    return res.data(
      {
          employee: {
            ...employee.toObject(),
            pin_hash: undefined,
            employee_session_id: user.employee_session_id || null,
          },
        employeeSession: null,
        assignedLocation,
        assignedTruckUnit,
        authToken,
      },
      'Employee is on duty'
    );
  } catch (e) {
    return next(e);
  }
};

exports.shiftAction = async (req, res, next) => {
  try {
    const { user, body } = req;
    const action = String(body.action || '').toUpperCase();
    const { employee, foodTruck, assignedLocation, assignedTruckUnit } =
      await assertEmployeeCanUseShift(user);
    let employeeSession = null;
    let authToken = null;

    if (action === 'START') {
      if (!employee.is_working) {
        return res.error(
          new Error('Employee must be On Duty before starting a shift'),
          403
        );
      }

      employeeSession = await EmployeeSessionService.startSessionForEmployee({
        employee,
        foodTruck,
        assignedLocation,
      });
      authToken = jwt.sign(
        {
          _id: employee._id,
          userType: 'EMPLOYEE',
          role: 'EMPLOYEE',
          employee_internal_id: employee.employee_internal_id,
          employee_session_id: employeeSession.employee_session_id,
          vendor_user_id: employee.vendor_user_id,
          food_truck_id: employee.food_truck_id,
          assigned_location_id: employee.assigned_location_id,
          assigned_truck_unit_id: employee.assigned_truck_unit_id || null,
        },
        JWT.secret,
        { expiresIn: '168h' }
      );
    } else if (action === 'PAUSE') {
      if (!employee.is_working) {
        return res.error(
          new Error('Employee must be On Duty before pausing a shift'),
          403
        );
      }

      employeeSession = await EmployeeSessionService.pauseSession({
        employeeSessionId: user.employee_session_id,
        employeeInternalId: user.employee_internal_id,
      });
    } else if (action === 'RESUME') {
      if (!employee.is_working) {
        return res.error(
          new Error('Employee must be On Duty before resuming a shift'),
          403
        );
      }

      employeeSession = await EmployeeSessionService.resumeSession({
        employeeSessionId: user.employee_session_id,
        employeeInternalId: user.employee_internal_id,
      });
    } else if (action === 'END') {
      employee.is_working = false;
      await employee.save();
      employeeSession = await EmployeeSessionService.endSession({
        employeeSessionId: user.employee_session_id,
        employeeInternalId: user.employee_internal_id,
      });
    } else {
      return res.error(new Error('Invalid shift action'), 409);
    }

    return res.data(
      {
        employee: {
          ...employee.toObject(),
          pin_hash: undefined,
          employee_session_id:
            action === 'END' ? null : employeeSession?.employee_session_id,
        },
        employeeSession,
        assignedLocation,
        assignedTruckUnit,
        authToken,
      },
      'Employee shift updated'
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
    const assignedTruckUnit = Service.getAssignedTruckUnit(
      foodTruck,
      user.assigned_truck_unit_id
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
      assignedTruckUnit,
    });

    return res.data({ dashboard }, 'Employee dashboard');
  } catch (e) {
    return next(e);
  }
};

exports.employeeOrders = async (req, res, next) => {
  try {
    const { user, query } = req;
    const statuses = query.status
      ? String(query.status)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : null;
    const orders = await EmployeeSessionService.getEmployeeCurrentDayOrders(
      user,
      statuses
    );

    return res.data({ orderList: orders, total: orders.length }, 'Employee orders');
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
