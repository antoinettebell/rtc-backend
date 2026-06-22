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

class EmployeeSessionService extends BaseService {
  constructor() {
    super(Model);
  }

  async endActiveSessions(employeeInternalId) {
    if (!employeeInternalId) {
      return null;
    }

    const now = new Date();
    return Model.updateMany(
      {
        employee_internal_id: employeeInternalId,
        is_active: true,
      },
      {
        $set: {
          ended_at: now,
          last_active_at: now,
          break_ended_at: now,
          shift_status: 'ENDED',
          is_active: false,
        },
      }
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
      shift_status: 'STARTED',
      is_active: true,
    });
  }

  async touchSession(employeeSessionId, employeeInternalId) {
    const q = {
      is_active: true,
      ...(employeeSessionId
        ? { employee_session_id: employeeSessionId }
        : { employee_internal_id: employeeInternalId }),
    };

    if (!q.employee_session_id && !q.employee_internal_id) {
      return null;
    }

    return Model.findOneAndUpdate(
      q,
      { $set: { last_active_at: new Date() } },
      { new: true }
    );
  }

  async endSession({ employeeSessionId, employeeInternalId }) {
    const q = {
      is_active: true,
      ...(employeeSessionId
        ? { employee_session_id: employeeSessionId }
        : { employee_internal_id: employeeInternalId }),
    };

    if (!q.employee_session_id && !q.employee_internal_id) {
      return null;
    }

    const now = new Date();
    return Model.findOneAndUpdate(
      q,
      {
        $set: {
          ended_at: now,
          last_active_at: now,
          break_ended_at: now,
          shift_status: 'ENDED',
          is_active: false,
        },
      },
      { new: true }
    );
  }

  async getActiveSession(employeeSessionId, employeeInternalId) {
    const q = {
      is_active: true,
      ...(employeeSessionId
        ? { employee_session_id: employeeSessionId }
        : { employee_internal_id: employeeInternalId }),
    };

    if (!q.employee_session_id && !q.employee_internal_id) {
      return null;
    }

    return Model.findOne(q).lean();
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
    const breakStart = session.break_started_at
      ? new Date(session.break_started_at)
      : null;
    const breakMinutes =
      breakStart && !Number.isNaN(breakStart.getTime())
        ? Math.max(0, Math.floor((now - breakStart) / 60000))
        : 0;

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

    const [todayOrders, requests] = await Promise.all([
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
      (sum, order) => sum + toNumber(order.totalOrderCost || order.total),
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
    const locationIsOpen = assignedTruckUnit
      ? truckOpenLocations.some(
          (location) =>
            location.locationId?.toString() ===
              user.assigned_location_id?.toString() &&
            location.isOrderingOpen
        )
      : foodTruck?.currentLocation?.toString() ===
          user.assigned_location_id?.toString() ||
        !!assignedLocation?.isOrderingOpen;

    return {
      employee: {
        employee_internal_id: user.employee_internal_id,
        employee_login_id: user.employee_login_id,
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
          activeSession?.employee_session_id ||
          user.employee_session_id ||
          null,
        started_at: activeSession?.started_at || null,
        ended_at: activeSession?.ended_at || null,
        last_active_at: activeSession?.last_active_at || null,
        paused_at: activeSession?.paused_at || null,
        resumed_at: activeSession?.resumed_at || null,
        break_started_at: activeSession?.break_started_at || null,
        break_ended_at: activeSession?.break_ended_at || null,
        total_break_minutes: activeSession?.total_break_minutes || 0,
        shift_status: activeSession?.shift_status || null,
        is_active: !!activeSession?.is_active,
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
    };
  }

  async getVendorEmployeeAnalytics({
    vendorUserId,
    foodTruck,
    startDate,
    endDate,
    locationId,
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
        const assignedLocation =
          locationsById[employee.assigned_location_id?.toString()] || null;

        return {
          employee_internal_id: employee.employee_internal_id,
          employee_login_id: employee.employee_login_id,
          employee_name:
            [employee.first_name, employee.last_name]
              .filter(Boolean)
              .join(' ') || 'Employee',
          assigned_location_id: employee.assigned_location_id,
          assigned_location: assignedLocation,
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
              (sum, order) =>
                sum + toNumber(order.totalOrderCost || order.total),
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
        employeeInternalId: employeeInternalId || null,
        paymentMethod: paymentMethod || null,
        refundCancelStatus: refundCancelStatus || null,
      },
      employees: employeesData,
    };
  }
}

module.exports = new EmployeeSessionService();
