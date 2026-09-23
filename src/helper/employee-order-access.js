const WALK_UP_ORDER_SOURCES = ['VENDOR_POS', 'WALK_UP_EMPLOYEE'];
const CUSTOMER_ORDER_SOURCE = 'CUSTOMER_APP';

const getOrderSource = (order = {}) =>
  order.orderSource || order.order_source || CUSTOMER_ORDER_SOURCE;

const idsMatch = (left, right) =>
  !!left && !!right && left.toString() === right.toString();

const buildEmployeeOrderScope = ({ user, start, end }) => {
  const scope = {
    foodTruckId: user.food_truck_id,
    deletedAt: null,
    $and: [
      {
        $or: [
          { created_at: { $gte: start, $lt: end } },
          {
            created_at: null,
            createdAt: { $gte: start, $lt: end },
          },
        ],
      },
      {
        $or: [
          { locationId: user.assigned_location_id },
          { location_id: user.assigned_location_id },
        ],
      },
    ],
  };

  if (user.assigned_truck_unit_id) {
    scope.$and.push({ truck_unit_id: user.assigned_truck_unit_id });
  }

  return scope;
};

const employeeCanAccessOrder = ({ user, order }) => {
  const locationId = order.locationId || order.location_id;
  const locationMatches = idsMatch(locationId, user.assigned_location_id);
  const truckMatches = user.assigned_truck_unit_id
    ? idsMatch(order.truck_unit_id, user.assigned_truck_unit_id)
    : true;

  return locationMatches && truckMatches;
};

const getEmployeeAllowedOrderStatuses = (order = {}) => {
  if (getOrderSource(order) === CUSTOMER_ORDER_SOURCE) {
    return [
      'ACCEPTED',
      'REJECTED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'COMPLETED',
    ];
  }

  if (WALK_UP_ORDER_SOURCES.includes(getOrderSource(order))) {
    return ['PREPARING', 'READY_FOR_PICKUP', 'COMPLETED'];
  }

  return [];
};

const assertEmployeeCanUpdateOrder = ({ user, order, orderStatus }) => {
  if (!employeeCanAccessOrder({ user, order })) {
    const error = new Error('Order not found or access denied');
    error.code = 404;
    throw error;
  }

  if (!getEmployeeAllowedOrderStatuses(order).includes(orderStatus)) {
    const error = new Error(
      'Employees can only update orders assigned to their current truck and location'
    );
    error.code = 403;
    throw error;
  }
};

module.exports = {
  CUSTOMER_ORDER_SOURCE,
  WALK_UP_ORDER_SOURCES,
  assertEmployeeCanUpdateOrder,
  buildEmployeeOrderScope,
  employeeCanAccessOrder,
  getEmployeeAllowedOrderStatuses,
  getOrderSource,
};
