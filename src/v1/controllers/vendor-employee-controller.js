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
const {
  getEmployeeScheduleState,
  getEmployeeScheduleAssignment,
  getEffectiveEmployeeAssignment,
} = require('../../helper/employee-weekly-schedule');

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
const parseBooleanFlag = (value) =>
  value === true || String(value).toLowerCase() === 'true';

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
    const shouldIncludeArchived = parseBooleanFlag(includeArchived);
    const shouldShowArchivedOnly = parseBooleanFlag(archivedOnly);

    const foodTruck = await Service.getVendorFoodTruckByUser(user._id);
    await assertEmployeeManagementAllowed(foodTruck);

    const data = await Service.listForVendor({
      vendor_user_id: user._id,
      food_truck_id: foodTruckId,
      includeArchived: shouldIncludeArchived,
      archivedOnly: shouldShowArchivedOnly,
    });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}List`]: data },
      `${entityName} items`
    );
  } catch (e) {
    return next(e);
  }
};

exports.shiftHistory = async (req, res, next) => {
  try {
    const {
      params: { id },
      query: { range = 'week' },
      user,
    } = req;

    const employee = await Service.getByData(
      {
        _id: id,
        vendor_user_id: user._id,
      },
      { singleResult: true }
    );

    if (!employee) {
      return res.error(new Error('Employee not found'), 404);
    }

    const sessions = await EmployeeSessionService.getEmployeeShiftHistory({
      foodTruckId: employee.food_truck_id,
      employeeInternalId: employee.employee_internal_id,
      range,
    });

    return res.data({ sessions }, 'Employee shift history');
  } catch (e) {
    return next(e);
  }
};

exports.updateShiftHistory = async (req, res, next) => {
  try {
    const { id, sessionId } = req.params;
    const employee = await Service.getByData(
      { _id: id, vendor_user_id: req.user._id },
      { singleResult: true }
    );
    if (!employee) return res.error(new Error('Employee not found'), 404);

    const session = await EmployeeSessionService.updateCompletedTimecard({
      foodTruckId: employee.food_truck_id,
      employeeInternalId: employee.employee_internal_id,
      sessionId,
      vendorUserId: req.user._id,
      startedAt: req.body.started_at,
      endedAt: req.body.ended_at,
      totalBreakMinutes: req.body.total_break_minutes,
      reason: req.body.reason,
    });
    return res.data({ session }, 'Employee timecard updated');
  } catch (e) {
    return next(e);
  }
};

exports.archiveShiftHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const employee = await Service.getByData(
      { _id: id, vendor_user_id: req.user._id },
      { singleResult: true }
    );
    if (!employee) return res.error(new Error('Employee not found'), 404);

    const activeSession = await EmployeeSessionService.getActiveSession(
      null,
      employee.employee_internal_id
    );
    if (activeSession) {
      return res.error(
        new Error('End the employee open shift before archiving shift history.'),
        409
      );
    }

    const result = await EmployeeSessionService.archiveCompletedTimecards({
      foodTruckId: employee.food_truck_id,
      employeeInternalId: employee.employee_internal_id,
      sessionIds: req.body.session_ids,
      vendorUserId: req.user._id,
    });
    return res.data(result, 'Employee timecards archived');
  } catch (e) {
    return next(e);
  }
};

exports.vendorShiftAction = async (req, res, next) => {
  try {
    const {
      params: { id },
      body: { action, reason },
      user,
    } = req;

    const employee = await Service.getScopedEmployee({
      vendor_user_id: user._id,
      employee_id: id,
      includeArchived: true,
    });

    if (!employee || employee.is_archived) {
      return res.error(new Error('Employee not found'), 404);
    }

    if (!employee.is_active) {
      return res.error(new Error('Employee is not active'), 403);
    }

    const foodTruck = await Service.getVendorFoodTruck(
      user._id,
      employee.food_truck_id
    );
    await assertEmployeeManagementAllowed(foodTruck);

    let employeeSession = null;
    if (action === 'END') {
      employeeSession = await EmployeeSessionService.endSession({
        employeeInternalId: employee.employee_internal_id,
      });
      if (!employeeSession) {
        return res.error(new Error('No active shift found to end'), 409);
      }
    } else if (action === 'OVERRIDE_START') {
      const latestSession = await EmployeeSessionService.getLatestOperationalDaySession(
        employee.employee_internal_id,
        employee.food_truck_id,
        foodTruck.schedule_time_zone || 'America/New_York'
      );
      if (!latestSession?.ended_at || latestSession.is_active) {
        return res.error(new Error('No clocked-out shift exists for this operational day'), 409);
      }
      const scheduled = employee.schedule_assignments?.length
        ? getEmployeeScheduleAssignment(
            employee.schedule_assignments,
            new Date(),
            foodTruck.schedule_time_zone || 'America/New_York'
          )
        : null;
      const overrideLocationId =
        scheduled?.assignment?.location_id ||
        latestSession.location_id ||
        employee.assigned_location_id;
      employeeSession = await EmployeeSessionService.startSessionForEmployee({
        employee,
        foodTruck,
        assignedLocation: (foodTruck.locations || []).find(
          (location) => location._id?.toString() === overrideLocationId?.toString()
        ),
        isVendorOverride: true,
        overrideReason: reason,
        approvedByUserId: user._id,
      });
      if (!employee.is_working) {
        employee.is_working = true;
        await employee.save();
      }
    } else {
      return res.error(new Error('Invalid shift action'), 409);
    }

    return res.data({ employeeSession }, 'Employee shift updated');
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
        phone_number,
        address_line1,
        address_city,
        address_state,
        address_zip,
	        employee_id_photo_url,
	        employee_tax_identifier_type,
	        employee_tax_identifier,
	        employee_rate,
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
      phone_number,
      address_line1,
      address_city,
      address_state,
      address_zip,
	      employee_id_photo_url,
	      employee_tax_identifier_type,
	      employee_tax_identifier,
	      employee_rate,
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

    if (body.tap_to_pay_serial_number !== undefined) {
      return res.error(
        new Error('Tap to Pay serial number is managed by support.'),
        403
      );
    }

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
      actor_user_id: user._id,
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
      actor_user_id: user._id,
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
    const shouldIncludeArchived = parseBooleanFlag(includeArchived);
    const shouldShowArchivedOnly = parseBooleanFlag(archivedOnly);

    const foodTruck = foodTruckId
      ? await Service.getVendorFoodTruck(vendorUserId, foodTruckId)
      : await Service.getVendorFoodTruckByUser(vendorUserId);
    const data = await Service.listForVendor({
      vendor_user_id: vendorUserId,
      food_truck_id: foodTruck?._id,
      includeArchived: shouldIncludeArchived,
      archivedOnly: shouldShowArchivedOnly,
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
        assigned_truck_unit_id,
        first_name,
	        last_name,
	        zip_code,
        phone_number,
        address_line1,
        address_city,
        address_state,
        address_zip,
	        employee_id_photo_url,
	        employee_tax_identifier_type,
	        employee_tax_identifier,
	        employee_rate,
	        tap_to_pay_serial_number,
	        pin,
        is_active,
        is_working,
      },
    } = req;

    const employee = await Service.createForVendor({
      vendor_user_id,
      food_truck_id,
      assigned_location_id,
      assigned_truck_unit_id,
      first_name,
	      last_name,
	      zip_code,
      phone_number,
      address_line1,
      address_city,
      address_state,
      address_zip,
	      employee_id_photo_url,
	      employee_tax_identifier_type,
	      employee_tax_identifier,
	      employee_rate,
	      tap_to_pay_serial_number,
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

exports.adminShiftHistory = async (req, res, next) => {
  try {
    const {
      params: { id },
      query: { range = 'week' },
    } = req;
    const employee = await Service.getByData(
      { _id: id },
      { singleResult: true }
    );
    if (!employee) return res.error(new Error('Employee not found'), 404);

    const sessions = await EmployeeSessionService.getEmployeeShiftHistory({
      foodTruckId: employee.food_truck_id,
      employeeInternalId: employee.employee_internal_id,
      range,
    });
    return res.data({ sessions }, 'Employee shift history');
  } catch (e) {
    return next(e);
  }
};

exports.adminUpdateShiftHistory = async (req, res, next) => {
  try {
    const { id, sessionId } = req.params;
    const employee = await Service.getByData(
      { _id: id },
      { singleResult: true }
    );
    if (!employee) return res.error(new Error('Employee not found'), 404);

    const session = await EmployeeSessionService.updateCompletedTimecard({
      foodTruckId: employee.food_truck_id,
      employeeInternalId: employee.employee_internal_id,
      sessionId,
      vendorUserId: req.user?._id,
      startedAt: req.body.started_at,
      endedAt: req.body.ended_at,
      totalBreakMinutes: req.body.total_break_minutes,
      reason: req.body.reason,
      allowArchived: true,
    });
    return res.data({ session }, 'Employee timecard updated');
  } catch (e) {
    return next(e);
  }
};

exports.adminUpdate = async (req, res, next) => {
  try {
    const {
      params: { id },
      body,
      user,
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
      actor_user_id: user?._id || employee.vendor_user_id,
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
      actor_user_id: req.user?._id || employee.vendor_user_id,
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

    if (!employeeSession) {
      return res.error(new Error('No active shift found to end'), 409);
    }

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

  const effectiveAssignment = getEffectiveEmployeeAssignment({
    employee,
    now: new Date(),
    timeZone: foodTruck.schedule_time_zone || 'America/New_York',
  });
  const assignedLocationId = effectiveAssignment.locationId;
  const assignedTruckUnitId = effectiveAssignment.truckUnitId;
  const assignedLocation = Service.getAssignedLocation(foodTruck, assignedLocationId);
  const assignedTruckUnit = assignedLocationId
    ? Service.getAssignedTruckUnit(foodTruck, assignedTruckUnitId)
    : null;
  if (!assignedLocation) {
    const error = new Error('Employee assigned location is unavailable');
    error.code = 404;
    throw error;
  }

  return { employee, foodTruck, assignedLocation, assignedTruckUnit };
};

exports.toggleDuty = async (req, res, next) => {
  try {
    return res.error(
      new Error('Duty status is managed by the vendor schedule'),
      403
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
      const hasWeeklySchedule =
        (Array.isArray(employee.schedule_assignments) && employee.schedule_assignments.length > 0) ||
        (Array.isArray(employee.weekly_schedule) && employee.weekly_schedule.length > 0);
      const scheduleState = employee.schedule_assignments?.length
        ? getEmployeeScheduleAssignment(employee.schedule_assignments, new Date(), foodTruck.schedule_time_zone || 'America/New_York') || { withinWindow: false }
        : hasWeeklySchedule
          ? getEmployeeScheduleState(employee.weekly_schedule, new Date(), foodTruck.schedule_time_zone || 'America/New_York')
          : null;
      if (hasWeeklySchedule && !scheduleState.withinWindow) {
        return res.error(
          new Error('You are not within your scheduled clock-in window. Please see your manager.'),
          403
        );
      }
      if (hasWeeklySchedule && !employee.is_working) {
        employee.is_working = true;
        await employee.save();
      } else if (!hasWeeklySchedule && !employee.is_working) {
        return res.error(new Error('Employee must be On Duty before starting a shift'), 403);
      }

      const latestSession =
        await EmployeeSessionService.getLatestOperationalDaySession(
          employee.employee_internal_id,
          employee.food_truck_id,
          foodTruck.schedule_time_zone || 'America/New_York'
        );
      if (latestSession?.ended_at && !latestSession?.is_active) {
        return res.error(
          new Error(
            'Your shift has ended. Please see your manager to be clocked back in.'
          ),
          403
        );
      }
      if (latestSession?.is_active) {
        return res.error(new Error('Employee shift is already active'), 409);
      }

      employeeSession = await EmployeeSessionService.startSessionForEmployee({
        employee,
        foodTruck,
        assignedLocation,
        assignedTruckUnit,
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
          assigned_location_id: assignedLocation._id,
          assigned_truck_unit_id: assignedTruckUnit?._id || null,
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
      employeeSession = await EmployeeSessionService.endSession({
        employeeSessionId: user.employee_session_id,
        employeeInternalId: user.employee_internal_id,
      });
      if (!employeeSession) {
        return res.error(new Error('No active shift found to end'), 409);
      }
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
    const { employee, foodTruck, assignedLocation, assignedTruckUnit } =
      await assertEmployeeCanUseShift(user);

    const dashboard = await EmployeeSessionService.getEmployeeDashboard({
      user: {
        ...user,
        tap_to_pay_serial_number: employee.tap_to_pay_serial_number || null,
        assigned_location_id: assignedLocation._id,
        assigned_truck_unit_id: assignedTruckUnit?._id || null,
      },
      foodTruck,
      assignedLocation,
      assignedTruckUnit,
    });
    dashboard.employee_schedule = employee.schedule_assignments || [];
    dashboard.schedule_time_zone =
      foodTruck.schedule_time_zone || 'America/New_York';

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
      truckUnitId: query.truckUnitId,
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
