const assert = require('assert');
const {
  assertEmployeeCanUpdateOrder,
  buildEmployeeOrderScope,
  employeeCanAccessOrder,
  getEmployeeAllowedOrderStatuses,
} = require('./employee-order-access');

const user = {
  food_truck_id: 'vendor-1',
  assigned_location_id: 'location-1',
  assigned_truck_unit_id: 'truck-1',
};
const start = new Date('2026-09-23T04:00:00.000Z');
const end = new Date('2026-09-24T04:00:00.000Z');
const scope = buildEmployeeOrderScope({ user, start, end });

assert.equal(scope.foodTruckId, 'vendor-1');
assert.deepEqual(scope.$and[1].$or, [
  { locationId: 'location-1' },
  { location_id: 'location-1' },
]);
assert.deepEqual(scope.$and[2], { truck_unit_id: 'truck-1' });

const deliveryOrder = {
  orderSource: 'CUSTOMER_APP',
  fulfillmentType: 'DELIVERY',
  locationId: 'location-1',
  truck_unit_id: 'truck-1',
};
const pickupOrder = { ...deliveryOrder, fulfillmentType: 'PICKUP' };

assert.equal(employeeCanAccessOrder({ user, order: deliveryOrder }), true);
assert.equal(employeeCanAccessOrder({ user, order: pickupOrder }), true);
assert.deepEqual(getEmployeeAllowedOrderStatuses(deliveryOrder), [
  'ACCEPTED',
  'REJECTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'COMPLETED',
]);
assert.doesNotThrow(() =>
  assertEmployeeCanUpdateOrder({
    user,
    order: deliveryOrder,
    orderStatus: 'ACCEPTED',
  })
);
assert.doesNotThrow(() =>
  assertEmployeeCanUpdateOrder({
    user,
    order: pickupOrder,
    orderStatus: 'REJECTED',
  })
);

assert.equal(
  employeeCanAccessOrder({
    user,
    order: { ...pickupOrder, truck_unit_id: 'truck-2' },
  }),
  false
);
assert.throws(
  () =>
    assertEmployeeCanUpdateOrder({
      user,
      order: { ...pickupOrder, locationId: 'location-2' },
      orderStatus: 'ACCEPTED',
    }),
  (error) => error.code === 404
);

const walkUpOrder = {
  orderSource: 'WALK_UP_EMPLOYEE',
  locationId: 'location-1',
  truck_unit_id: 'truck-1',
};
assert.deepEqual(getEmployeeAllowedOrderStatuses(walkUpOrder), [
  'PREPARING',
  'READY_FOR_PICKUP',
  'COMPLETED',
]);
assert.throws(
  () =>
    assertEmployeeCanUpdateOrder({
      user,
      order: walkUpOrder,
      orderStatus: 'REJECTED',
    }),
  (error) => error.code === 403
);

console.log('employee order access tests passed');
