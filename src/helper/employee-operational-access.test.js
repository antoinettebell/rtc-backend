const assert = require('assert');
const {
  EMPLOYEE_ASSIGNED_LOCATION_CLOSED_MESSAGE,
  assertAssignedEmployeeLocationOpen,
  isAssignedEmployeeLocationOpen,
  isEmployeeOrderOperation,
} = require('./employee-operational-access');

const assignedTruckUnitId = 'truck-1';
const assignedLocationId = 'location-1';

const buildFoodTruck = ({ assignedOpen = false, otherOpen = false } = {}) => ({
  truck_units: [
    {
      _id: assignedTruckUnitId,
      open_locations: assignedOpen
        ? [{ locationId: assignedLocationId, isOrderingOpen: true }]
        : [],
    },
    {
      _id: 'truck-2',
      open_locations: otherOpen
        ? [{ locationId: 'location-2', isOrderingOpen: true }]
        : [],
    },
  ],
});

assert.equal(
  isAssignedEmployeeLocationOpen({
    foodTruck: buildFoodTruck({ assignedOpen: true }),
    assignedTruckUnitId,
    assignedLocationId,
  }),
  true,
  'the exact assigned truck/location is operational'
);

assert.throws(
  () =>
    assertAssignedEmployeeLocationOpen({
      foodTruck: buildFoodTruck({ otherOpen: true }),
      assignedTruckUnitId,
      assignedLocationId,
    }),
  (error) =>
    error.code === 403 &&
    error.message === EMPLOYEE_ASSIGNED_LOCATION_CLOSED_MESSAGE,
  'backend operational enforcement rejects another open location'
);

[
  '/api/v1/order',
  '/api/v1/order/validate-order',
  '/api/v1/order/payment-checkout',
  '/api/v1/order/order-1',
  '/api/v1/vendor-employee/orders',
  '/api/v1/vendor-employee/refund-cancel-requests',
].forEach((originalUrl) => {
  assert.equal(
    isEmployeeOrderOperation({ originalUrl }),
    true,
    `${originalUrl} must enforce the assigned operating location`
  );
});

assert.equal(
  isEmployeeOrderOperation({
    originalUrl: '/api/v1/vendor-employee/session/action',
  }),
  false,
  'employees must still be able to open their assigned location'
);

assert.equal(
  isAssignedEmployeeLocationOpen({
    foodTruck: buildFoodTruck({ otherOpen: true }),
    assignedTruckUnitId,
    assignedLocationId,
  }),
  false,
  'another open location must not authorize the employee'
);

assert.equal(
  isAssignedEmployeeLocationOpen({
    foodTruck: buildFoodTruck({ assignedOpen: false }),
    assignedTruckUnitId,
    assignedLocationId,
  }),
  false,
  'a closed assigned location is not operational'
);

assert.equal(
  EMPLOYEE_ASSIGNED_LOCATION_CLOSED_MESSAGE,
  'Your assigned location is closed. Open this location before taking orders.'
);

console.log('employee operational access tests passed');
