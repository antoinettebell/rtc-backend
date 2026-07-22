const {
  EmployeeSessionModel: Model,
  OrderModel,
  VendorEmployeeModel,
  EmployeeRefundCancelRequestModel,
} = require('../../models');
const { BaseService } = require('../../common-services');

const toNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const isCashPayment = (paymentMethod) =>
  ['CASH', 'COD'].includes(String(paymentMethod || '').toUpperCase());

const isTapPayment = (paymentMethod) =>
  String(paymentMethod || '').toUpperCase() === 'TAP_TO_PAY';

const getCurrentDayRange = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

const getOrderSubtotal = (order) =>
  toNumber(order.subTotal || order.subtotal || order.sub_total);

const getOrderTax = (order) =>
  toNumber(order.taxAmount || order.tax || order.tax_amount);

const getOrderVendorTip = (order) =>
  toNumber(order.tipsAmount || order.foodTruckTip || order.vendorTip);

const isWalkUpOrder = (order) =>
  ['VENDOR_POS', 'WALK_UP_EMPLOYEE'].includes(
    String(order.order_source || order.orderSource || '').toUpperCase()
  );

const getOrderFoodSalesAmount = (order) => {
  const hasTotalAfterDiscount =
    order.totalAfterDiscount !== undefined && order.totalAfterDiscount !== null;
  const foodSubtotal = hasTotalAfterDiscount
    ? toNumber(order.totalAfterDiscount)
    : Math.max(
        0,
        getOrderSubtotal(order) -
          toNumber(order.discount || order.discountAmount || order.disAmount)
      );

  return (
    foodSubtotal +
    getOrderVendorTip(order) +
    (isWalkUpOrder(order) ? getOrderTax(order) : 0)
  );
};

const getShiftRange = (range = 'week') => {
  const end = new Date();
  const start = new Date(end);

  if (range === 'day') {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
  }

  return { start, end };
};

const summarizeSessions = (sessions = []) => {
  const totals = sessions.reduce(
    (acc, session) => ({
      grossWorkMinutes: acc.grossWorkMinutes + toNumber(session.gross_work_minutes),
      netWorkMinutes: acc.netWorkMinutes + toNumber(session.net_work_minutes),
      breakMinutes: acc.breakMinutes + toNumber(session.total_break_minutes),
      sessionCount: acc.sessionCount + 1,
    }),
    {
      grossWorkMinutes: 0,
      netWorkMinutes: 0,
      breakMinutes: 0,
      sessionCount: 0,
    }
  );

  return {
    session_count: totals.sessionCount,
    gross_work_minutes: totals.grossWorkMinutes,
    net_work_minutes: totals.netWorkMinutes,
    break_minutes: totals.breakMinutes,
    gross_hours_worked: Number((totals.grossWorkMinutes / 60).toFixed(2)),
    net_hours_worked: Number((totals.netWorkMinutes / 60).toFixed(2)),
  };
};

const getOpenBreakMinutes = (session, endedAt = new Date()) => {
  if (session?.shift_status !== 'ON_BREAK' || !session?.break_started_at) {
    return 0;
  }

  const startedAt = new Date(session.break_started_at);
  if (Number.isNaN(startedAt.getTime())) {
    return 0;
  }

  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
};
const getWorkDateKey = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};
const getClosedShiftTotals = (session, endedAt = new Date()) => {
  const startedAt = session?.started_at ? new Date(session.started_at) : null;
  const startedTime =
    startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt.getTime() : null;
  const endedTime =
    endedAt && !Number.isNaN(endedAt.getTime()) ? endedAt.getTime() : null;
  const grossWorkMinutes =
    startedTime && endedTime
      ? Math.max(0, Math.round((endedTime - startedTime) / 60000))
      : 0;
  const totalBreakMinutes =
    Number(session?.total_break_minutes || 0) + getOpenBreakMinutes(session, endedAt);
  const netWorkMinutes = Math.max(0, grossWorkMinutes - totalBreakMinutes);

  return {
    grossWorkMinutes,
    netWorkMinutes,
    grossHoursWorked: Number((grossWorkMinutes / 60).toFixed(2)),
    netHoursWorked: Number((netWorkMinutes / 60).toFixed(2)),
    totalBreakMinutes,
    workDateKey: getWorkDateKey(session?.started_at),
  };
};
const getCloseShiftUpdate = (session, endedAt = new Date()) => {
  const totals = getClosedShiftTotals(session, endedAt);

  return {
    $set: {
      ended_at: endedAt,
      last_active_at: endedAt,
      break_ended_at: endedAt,
      break_started_at: null,
      total_break_minutes: totals.totalBreakMinutes,
      gross_work_minutes: totals.grossWorkMinutes,
      net_work_minutes: totals.netWorkMinutes,
      gross_hours_worked: totals.grossHoursWorked,
      net_hours_worked: totals.netHoursWorked,
      work_date_key: totals.workDateKey,
      shift_status: 'ENDED',
      is_active: false,
    },
  };
};

class EmployeeSessionService extends BaseService {
  constructor() {
    super(Model);
  }

  async endActiveSessions(employeeInternalId) {
    if (!employeeInternalId) {
      return null;
    }

    const now = new Date();
    const sessions = await Model.find({
      employee_internal_id: employeeInternalId,
      is_active: true,
    }).lean();

    if (!sessions.length) {
      return null;
    }

    return Model.bulkWrite(
      sessions.map((session) => ({
        updateOne: {
          filter: { _id: session._id },
          update: getCloseShiftUpdate(session, now),
        },
      }))
    );
  }

  async startSessionForEmployee({ employee, foodTruck, assignedLocation }) {
    await this.endActiveSessions(employee.employee_internal_id);

    const now = new Date();
    return this.create({
      employee_internal_id: employee.employee_internal_id,
      vendor_user_id: employee.vendor_user_id,
      food_truck_id: employee.food_truck_id || foodTruck?._id,
      location_id: employee.assigned_location_id || assignedLocation?._id,
      started_at: now,
      last_active_at: now,
      paused_at: null,
      resumed_at: null,
      break_started_at: null,
      break_ended_at: null,
      total_break_minutes: 0,
      gross_work_minutes: null,
      net_work_minutes: null,
      gross_hours_worked: null,
      net_hours_worked: null,
      work_date_key: getWorkDateKey(now),
      shift_status: 'STARTED',
      is_active: true,
    });
  }

  async touchSession(employeeSessionId, employeeInternalId) {
    if (!employeeSessionId && !employeeInternalId) {
      return null;
    }

    const session = await this.getActiveSession(employeeSessionId, employeeInternalId);
    if (!session) {
      return null;
    }

    return Model.findOneAndUpdate(
      { _id: session._id },
      { $set: { last_active_at: new Date() } },
      { new: true }
    );
  }

  async endSession({ employeeSessionId, employeeInternalId }) {
    if (!employeeSessionId && !employeeInternalId) {
      return null;
    }

    const session = await this.getActiveSession(employeeSessionId, employeeInternalId);
    if (!session) {
      return null;
    }

    const now = new Date();
    return Model.findOneAndUpdate(
      { _id: session._id },
      getCloseShiftUpdate(session, now),
      { new: true }
    );
  }

  async getLatestSessionForEmployee(employeeInternalId) {
    if (!employeeInternalId) {
      return null;
    }

    return Model.findOne({
      employee_internal_id: employeeInternalId,
    })
      .sort({ started_at: -1, createdAt: -1 })
      .lean();
  }

  async getLatestCurrentDaySession(employeeInternalId) {
    if (!employeeInternalId) {
      return null;
    }

    const { start, end } = getCurrentDayRange();
    return Model.findOne({
      employee_internal_id: employeeInternalId,
      started_at: { $gte: start, $lt: end },
    })
      .sort({ started_at: -1, createdAt: -1 })
      .lean();
  }

  async reopenLatestEndedSession(employeeInternalId) {
    const session = await this.getLatestCurrentDaySession(employeeInternalId);
    if (!session || session.is_active) {
      return session;
    }

    const now = new Date();
    return Model.findOneAndUpdate(
      { _id: session._id },
      {
        $set: {
          ended_at: null,
          last_active_at: now,
          break_started_at: null,
          break_ended_at: null,
          gross_work_minutes: null,
          net_work_minutes: null,
          gross_hours_worked: null,
          net_hours_worked: null,
          shift_status: 'STARTED',
          is_active: true,
        },
      },
      { new: true }
    );
  }

  async getActiveSession(employeeSessionId, employeeInternalId) {
    if (!employeeSessionId && !employeeInternalId) {
      return null;
    }

    if (employeeSessionId) {
      const session = await Model.findOne({
        employee_session_id: employeeSessionId,
        ...(employeeInternalId ? { employee_internal_id: employeeInternalId } : {}),
        is_active: true,
      }).lean();

      if (session) {
        return session;
      }
    }

    if (!employeeInternalId) {
      return null;
    }

    return Model.findOne({
      employee_internal_id: employeeInternalId,
      is_active: true,
    })
      .sort({ last_active_at: -1, started_at: -1 })
      .lean();
  }

  async assertActiveEmployeeSession(employeeSessionId, employeeInternalId) {
    const session = await this.getActiveSession(
      employeeSessionId,
      employeeInternalId
    );

    if (!session) {
      const error = new Error(
        'Employee session is not active. Please go on duty before creating orders.'
      );
      error.code = 403;
      throw error;
    }

    return session;
  }

  async pauseSession({ employeeSessionId, employeeInternalId }) {
    const session = await this.assertActiveEmployeeSession(
      employeeSessionId,
      employeeInternalId
    );

    if (session.shift_status === 'ON_BREAK') {
      return session;
    }

    if ((session.break_count || 0) >= 2) {
      const error = new Error('Maximum of two breaks reached for this shift.');
      error.code = 403;
      throw error;
    }

    const now = new Date();
    return Model.findOneAndUpdate(
      { _id: session._id },
      {
        $set: {
          paused_at: now,
          break_started_at: now,
          last_active_at: now,
          shift_status: 'ON_BREAK',
        },
        $inc: { break_count: 1 },
      },
      { new: true }
    );
  }

  async resumeSession({ employeeSessionId, employeeInternalId }) {
    const session = await this.assertActiveEmployeeSession(
      employeeSessionId,
      employeeInternalId
    );

    const now = new Date();
    const breakMinutes = getOpenBreakMinutes(session, now);
    return Model.findOneAndUpdate(
      { _id: session._id },
      {
        $set: {
          resumed_at: now,
          break_ended_at: now,
          break_started_at: null,
          last_active_at: now,
          shift_status: 'STARTED',
        },
        $inc: { total_break_minutes: breakMinutes },
      },
      { new: true }
    );
  }

  async getEmployeeCurrentDayOrders(user, statuses = null) {
    const { start, end } = getCurrentDayRange();
    const query = {
      created_by_type: 'EMPLOYEE',
      employee_internal_id: user.employee_internal_id,
      food_truck_id: user.food_truck_id,
      location_id: user.assigned_location_id,
      deletedAt: null,
      $or: [
        { created_at: { $gte: start, $lt: end } },
        {
          created_at: null,
          createdAt: { $gte: start, $lt: end },
        },
      ],
      ...(Array.isArray(statuses) && statuses.length
        ? { orderStatus: { $in: statuses } }
        : {}),
    };

    return OrderModel.find(query).sort({ created_at: -1, createdAt: -1 }).lean();
  }

  async getEmployeeDashboard({
    user,
    foodTruck,
    assignedLocation,
    assignedTruckUnit = null,
  }) {
    const { start: startOfToday, end: endOfToday } = getCurrentDayRange();

    const activeSession = await this.getActiveSession(
      user.employee_session_id,
      user.employee_internal_id
    );
    const latestSession =
      activeSession ||
      (await this.getLatestCurrentDaySession(user.employee_internal_id));

    const [todayOrders, requests, todayShiftSummary, weekShiftSummary] = await Promise.all([
      OrderModel.find({
        created_by_type: 'EMPLOYEE',
        employee_internal_id: user.employee_internal_id,
        food_truck_id: user.food_truck_id,
        location_id: user.assigned_location_id,
        deletedAt: null,
        $or: [
          { created_at: { $gte: startOfToday, $lt: endOfToday } },
          {
            created_at: null,
            createdAt: { $gte: startOfToday, $lt: endOfToday },
          },
        ],
      }).lean(),
      EmployeeRefundCancelRequestModel.find({
        employee_internal_id: user.employee_internal_id,
        food_truck_id: user.food_truck_id,
        location_id: user.assigned_location_id,
        requested_at: { $gte: startOfToday, $lt: endOfToday },
      }).lean(),
      this.getEmployeeShiftSummary({
        foodTruckId: user.food_truck_id,
        employeeInternalId: user.employee_internal_id,
        range: 'day',
      }),
      this.getEmployeeShiftSummary({
        foodTruckId: user.food_truck_id,
        employeeInternalId: user.employee_internal_id,
        range: 'week',
      }),
    ]);

    const completedOrders = todayOrders.filter(
      (order) => order.orderStatus === 'COMPLETED'
    );
    const salesOrders = todayOrders.filter(
      (order) =>
        !['CANCEL', 'REJECTED'].includes(order.orderStatus) &&
        order.paymentStatus !== 'REFUNDED'
    );

    const grossSalesToday = salesOrders.reduce(
      (sum, order) => sum + getOrderFoodSalesAmount(order),
      0
    );
    const cashSalesOrders = salesOrders.filter((order) =>
      isCashPayment(order.payment_method || order.paymentMethod)
    );
    const cashDrawerTotal = cashSalesOrders.reduce(
      (sum, order) => sum + getOrderSubtotal(order) + getOrderTax(order),
      0
    );

    const refundCancelStatusCounts = requests.reduce(
      (counts, order) => {
        if (order.request_status === 'REJECTED') {
          counts.rejected += 1;
        } else if (order.request_status === 'APPROVED') {
          counts.approved += 1;
        } else {
          counts.pending += 1;
        }

        return counts;
      },
      { pending: 0, approved: 0, rejected: 0 }
    );

    const truckOpenLocations = assignedTruckUnit?.open_locations || [];
    const locationIsOpen = !!assignedTruckUnit
      ? truckOpenLocations.some(
          (location) =>
            location.locationId?.toString() ===
              user.assigned_location_id?.toString() &&
            location.isOrderingOpen
        )
      : false;

    return {
      employee: {
        employee_internal_id: user.employee_internal_id,
        employee_login_id: user.employee_login_id,
        phone_number: user.phone_number || null,
        address_line1: user.address_line1 || null,
        address_city: user.address_city || null,
        address_state: user.address_state || null,
        zip_code: user.zip_code || null,
        employee_rate: user.employee_rate ?? null,
        is_working: !!user.is_working,
        name:
          [user.first_name, user.last_name].filter(Boolean).join(' ') ||
          'Employee',
      },
      assignedLocation,
      assignedTruckUnit,
      location: {
        location_id: user.assigned_location_id,
        is_open: locationIsOpen,
      },
      shift: {
        employee_session_id:
          latestSession?.employee_session_id ||
          user.employee_session_id ||
          null,
        started_at: latestSession?.started_at || null,
        ended_at: latestSession?.ended_at || null,
        last_active_at: latestSession?.last_active_at || null,
        paused_at: latestSession?.paused_at || null,
        resumed_at: latestSession?.resumed_at || null,
        break_started_at: latestSession?.break_started_at || null,
        break_ended_at: latestSession?.break_ended_at || null,
        total_break_minutes: latestSession?.total_break_minutes || 0,
        break_count: latestSession?.break_count || 0,
        shift_status: latestSession?.shift_status || null,
        is_active: !!latestSession?.is_active,
      },
	      metrics: {
        orders_created_today: todayOrders.length,
        completed_orders_today: completedOrders.length,
        gross_sales_today: grossSalesToday,
        cash_orders_today: todayOrders.filter((order) =>
          isCashPayment(order.payment_method || order.paymentMethod)
        ).length,
        cash_drawer_total: cashDrawerTotal,
        cash_drawer_order_count: cashSalesOrders.length,
        tap_orders_today: todayOrders.filter((order) =>
          isTapPayment(order.payment_method || order.paymentMethod)
        ).length,
        refund_cancel_requests_submitted: requests.length,
	        refund_cancel_request_status_counts: refundCancelStatusCounts,
	      },
	      shift_summary: {
	        today: todayShiftSummary,
	        week: weekShiftSummary,
	      },
	    };
	  }

  async getVendorEmployeeAnalytics({
    vendorUserId,
    foodTruck,
    startDate,
    endDate,
    locationId,
    truckUnitId,
    employeeInternalId,
    paymentMethod,
    refundCancelStatus,
  }) {
    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now);
    if (!startDate) {
      start.setHours(0, 0, 0, 0);
    }

    const end = endDate ? new Date(endDate) : new Date(start);
    if (endDate) {
      end.setHours(23, 59, 59, 999);
    } else {
      end.setDate(end.getDate() + 1);
    }

    const employees = await VendorEmployeeModel.find({
      vendor_user_id: vendorUserId,
      food_truck_id: foodTruck._id,
      ...(truckUnitId ? { assigned_truck_unit_id: truckUnitId } : {}),
      is_archived: false,
      ...(employeeInternalId
        ? { employee_internal_id: employeeInternalId }
        : {}),
    }).lean();

    const employeeIds = employees.map(
      (employee) => employee.employee_internal_id
    );
    if (!employeeIds.length) {
      return {
        filters: {
          startDate: start,
          endDate: end,
          locationId: locationId || null,
          truckUnitId: truckUnitId || null,
          employeeInternalId: employeeInternalId || null,
          paymentMethod: paymentMethod || null,
          refundCancelStatus: refundCancelStatus || null,
        },
        employees: [],
      };
    }

    const sessionQuery = {
      employee_internal_id: { $in: employeeIds },
      food_truck_id: foodTruck._id,
      ...(locationId ? { location_id: locationId } : {}),
    };
    const orderQuery = {
      created_by_type: 'EMPLOYEE',
      employee_internal_id: { $in: employeeIds },
      food_truck_id: foodTruck._id,
      deletedAt: null,
      ...(locationId ? { location_id: locationId } : {}),
      ...(truckUnitId ? { truck_unit_id: truckUnitId } : {}),
      ...(paymentMethod
        ? {
            $and: [
              {
                $or: [{ payment_method: paymentMethod }, { paymentMethod }],
              },
            ],
          }
        : {}),
      $or: [
        { created_at: { $gte: start, $lte: end } },
        {
          created_at: null,
          createdAt: { $gte: start, $lte: end },
        },
      ],
    };

    const [sessions, orders, requests] = await Promise.all([
      Model.find(sessionQuery)
        .sort({ last_active_at: -1, started_at: -1 })
        .lean(),
      OrderModel.find(orderQuery).lean(),
      EmployeeRefundCancelRequestModel.find({
        employee_internal_id: { $in: employeeIds },
        food_truck_id: foodTruck._id,
        requested_at: { $gte: start, $lte: end },
        ...(locationId ? { location_id: locationId } : {}),
        ...(refundCancelStatus
          ? { request_status: refundCancelStatus.toUpperCase() }
          : {}),
      }).lean(),
    ]);

    const sessionsByEmployee = sessions.reduce((map, session) => {
      if (!map[session.employee_internal_id]) {
        map[session.employee_internal_id] = session;
      }
      return map;
    }, {});

	    const locationsById = (foodTruck.locations || []).reduce(
      (map, location) => {
        if (location?._id) {
          map[location._id.toString()] = location;
        }
        return map;
      },
      {}
	    );
	    const truckUnitsById = (foodTruck.truck_units || []).reduce(
	      (map, truckUnit) => {
	        if (truckUnit?._id) {
	          map[truckUnit._id.toString()] = truckUnit;
	        }
	        return map;
	      },
	      {}
	    );

    const getRefundCancelStatus = (request) => {
      if (request.request_status === 'REJECTED') {
        return 'rejected';
      }
      if (request.request_status === 'APPROVED') {
        return 'approved';
      }
      if (request.request_status === 'PENDING') {
        return 'pending';
      }
      return null;
    };

    const employeesData = employees
      .map((employee) => {
        const employeeOrders = orders.filter(
          (order) =>
            order.employee_internal_id === employee.employee_internal_id
        );
        const filteredOrders = refundCancelStatus
          ? employeeOrders.filter((order) =>
              requests.some(
                (request) =>
                  request.order_id?.toString() === order._id?.toString() &&
                  request.employee_internal_id === employee.employee_internal_id
              )
            )
          : employeeOrders;
        const completedOrders = filteredOrders.filter(
          (order) => order.orderStatus === 'COMPLETED'
        );
        const salesOrders = filteredOrders.filter(
          (order) =>
            !['CANCEL', 'REJECTED'].includes(order.orderStatus) &&
            order.paymentStatus !== 'REFUNDED'
        );
        const employeeRequests = requests.filter(
          (request) =>
            request.employee_internal_id === employee.employee_internal_id
        );
        const refundCancelStatusCounts = employeeRequests.reduce(
          (counts, request) => {
            const status = getRefundCancelStatus(request);
            if (status) {
              counts[status] += 1;
            }
            return counts;
          },
          { pending: 0, approved: 0, rejected: 0 }
        );
	        const session =
	          sessionsByEmployee[employee.employee_internal_id] || null;
	        const employeeSessions = sessions.filter(
	          (item) => item.employee_internal_id === employee.employee_internal_id
	        );
	        const shiftSummary = summarizeSessions(employeeSessions);
		        const assignedLocation =
	          locationsById[employee.assigned_location_id?.toString()] || null;
	        const assignedTruckUnit =
	          truckUnitsById[employee.assigned_truck_unit_id?.toString()] || null;

        return {
          employee_id: employee._id,
          employee_internal_id: employee.employee_internal_id,
          employee_login_id: employee.employee_login_id,
          employee_name:
            [employee.first_name, employee.last_name]
              .filter(Boolean)
              .join(' ') || 'Employee',
	          assigned_location_id: employee.assigned_location_id,
	          assigned_location: assignedLocation,
	          assigned_truck_unit_id: employee.assigned_truck_unit_id || null,
	          assigned_truck_unit_name:
	            employee.assigned_truck_unit_name ||
	            assignedTruckUnit?.name ||
	            null,
          is_active: !!employee.is_active,
          is_working: !!employee.is_working,
          last_activity_at:
            session?.last_active_at || employee.last_login_at || null,
          shift: {
            employee_session_id: session?.employee_session_id || null,
            started_at: session?.started_at || null,
            ended_at: session?.ended_at || null,
            is_active: !!session?.is_active,
          },
          metrics: {
            orders_processed: filteredOrders.length,
            completed_orders: completedOrders.length,
            gross_sales: salesOrders.reduce(
              (sum, order) => sum + getOrderFoodSalesAmount(order),
              0
            ),
            cash_orders: filteredOrders.filter((order) =>
              isCashPayment(order.payment_method || order.paymentMethod)
            ).length,
            tap_orders: filteredOrders.filter((order) =>
              isTapPayment(order.payment_method || order.paymentMethod)
            ).length,
	            refund_cancel_requests_submitted: employeeRequests.length,
	            refund_cancel_request_status_counts: refundCancelStatusCounts,
	            gross_work_minutes: shiftSummary.gross_work_minutes,
	            net_work_minutes: shiftSummary.net_work_minutes,
	            break_minutes: shiftSummary.break_minutes,
	            gross_hours_worked: shiftSummary.gross_hours_worked,
	            net_hours_worked: shiftSummary.net_hours_worked,
	          },
	        };
      })
      .filter(
        (employee) =>
          !locationId ||
          employee.assigned_location_id?.toString() === locationId?.toString()
      );

    return {
      filters: {
        startDate: start,
        endDate: end,
	        locationId: locationId || null,
	        truckUnitId: truckUnitId || null,
	        employeeInternalId: employeeInternalId || null,
        paymentMethod: paymentMethod || null,
        refundCancelStatus: refundCancelStatus || null,
      },
      employees: employeesData,
    };
  }

	  async getEmployeeShiftHistory({
	    foodTruckId,
	    employeeInternalId,
	    range = 'week',
	  }) {
	    const { start, end } = getShiftRange(range);

	    return Model.find({
      food_truck_id: foodTruckId,
      employee_internal_id: employeeInternalId,
      started_at: { $gte: start, $lte: end },
    })
      .sort({ started_at: -1 })
	      .limit(100)
	      .select(
	        'employee_session_id started_at ended_at last_active_at shift_status is_active total_break_minutes gross_work_minutes net_work_minutes gross_hours_worked net_hours_worked work_date_key'
	      )
	      .lean();
	  }

	  async getEmployeeShiftSummary({
	    foodTruckId,
	    employeeInternalId,
	    range = 'week',
	  }) {
	    const { start, end } = getShiftRange(range);
	    const sessions = await Model.find({
	      food_truck_id: foodTruckId,
	      employee_internal_id: employeeInternalId,
	      started_at: { $gte: start, $lte: end },
	      is_active: false,
	    })
	      .select(
	        'total_break_minutes gross_work_minutes net_work_minutes gross_hours_worked net_hours_worked'
	      )
	      .lean();

	    return summarizeSessions(sessions);
	  }
	}

module.exports = new EmployeeSessionService();
