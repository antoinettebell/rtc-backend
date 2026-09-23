const assert = require('assert');
const mongoose = require('mongoose');
const { FoodTruckModel, OrderModel } = require('../models');
const OrderService = require('../v1/services/order-service');
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

const verifyEmployeeCanOpenAssignedCustomerOrder = async () => {
  const originalFindById = FoodTruckModel.findById;
  const originalAggregate = OrderModel.aggregate;
  const currentOrder = {
    _id: new mongoose.Types.ObjectId(),
    foodTruckId: new mongoose.Types.ObjectId(),
    locationId: 'location-1',
    truck_unit_id: 'truck-1',
    orderSource: 'CUSTOMER_APP',
    createdAt: new Date(),
    items: [],
  };
  let matchedScope = null;

  FoodTruckModel.findById = () => ({
    select: () => ({
      lean: async () => ({ schedule_time_zone: 'America/New_York' }),
    }),
  });
  OrderModel.aggregate = async (pipeline) => {
    matchedScope = pipeline.find((stage) => stage.$match)?.$match || null;
    return [{
      records: [currentOrder],
      metaData: [{ total: 1 }],
    }];
  };

  try {
    const result = await OrderService.getWithAllDetails(
      1,
      1,
      {
        _id: new mongoose.Types.ObjectId(),
        userType: 'EMPLOYEE',
        food_truck_id: currentOrder.foodTruckId,
        assigned_location_id: 'location-1',
        assigned_truck_unit_id: 'truck-1',
        employee_internal_id: 'employee-1',
      },
      '',
      currentOrder._id,
    );

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].orderSource, 'CUSTOMER_APP');
    assert.equal(matchedScope.created_by_type, undefined);
    assert.equal(matchedScope.employee_internal_id, undefined);
    assert.deepEqual(matchedScope.$and[1].$or, [
      { locationId: 'location-1' },
      { location_id: 'location-1' },
    ]);
    assert.deepEqual(matchedScope.$and[2], { truck_unit_id: 'truck-1' });
  } finally {
    FoodTruckModel.findById = originalFindById;
    OrderModel.aggregate = originalAggregate;
  }
};

verifyEmployeeCanOpenAssignedCustomerOrder()
  .then(() => console.log('employee order access tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
