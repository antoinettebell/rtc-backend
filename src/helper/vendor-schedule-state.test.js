const assert = require('assert');

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { filename, loaded: true, exports };
};

mockModule('../models', { FoodTruckModel: {}, UserModel: {} });
mockModule('./custom-notification', class CustomNotification {});
mockModule('../v1/services/vendor-compliance-service', {});

const {
  reconcileFoodTruckWeeklySchedule,
} = require('../v1/controllers/webhook-controller');

const makeFoodTruck = ({ availability, openLocations = [] }) => ({
  availability,
  locations: [{ _id: 'location-1', isOrderingOpen: false }],
  truck_units: [
    {
      _id: 'unit-1',
      is_archived: false,
      open_locations: openLocations,
    },
  ],
  currentLocation: null,
  markModified() {},
});

const reconcile = (foodTruck, iso) =>
  reconcileFoodTruckWeeklySchedule(
    foodTruck,
    new Date(iso),
    'America/New_York'
  );

{
  const foodTruck = makeFoodTruck({
    availability: [
      {
        day: 'wed',
        locationId: 'location-1',
        truckUnitId: 'unit-1',
        startTime: '09:00',
        endTime: '17:00',
        available: true,
      },
    ],
  });

  const result = reconcile(foodTruck, '2026-07-29T14:00:00.000Z');
  assert.equal(result.scheduledOpenPairs, 1);
  assert.equal(foodTruck.locations[0].isOrderingOpen, true);
  assert.equal(foodTruck.truck_units[0].open_locations[0].status_source, 'SCHEDULE');
}

{
  const foodTruck = makeFoodTruck({
    availability: [
      {
        day: 'tue',
        locationId: 'location-1',
        truckUnitId: 'unit-1',
        startTime: '22:00',
        endTime: '02:00',
        available: true,
      },
    ],
  });

  const result = reconcile(foodTruck, '2026-07-29T05:00:00.000Z');
  assert.equal(result.scheduledOpenPairs, 1);
  assert.equal(foodTruck.locations[0].isOrderingOpen, true);
}

// A previous-day overnight slot remains active after midnight until its exact
// end time, but must not become active again the following evening.
{
  const availability = [
    {
      day: 'tue',
      locationId: 'location-1',
      truckUnitId: 'unit-1',
      startTime: '09:00',
      endTime: '03:00',
      available: true,
    },
  ];

  const afterMidnight = makeFoodTruck({ availability });
  reconcile(afterMidnight, '2026-08-05T06:59:00.000Z');
  assert.equal(afterMidnight.locations[0].isOrderingOpen, true);

  const exactClose = makeFoodTruck({ availability });
  reconcile(exactClose, '2026-08-05T07:00:00.000Z');
  assert.equal(exactClose.locations[0].isOrderingOpen, false);

  const followingEvening = makeFoodTruck({ availability });
  reconcile(followingEvening, '2026-08-05T23:22:00.000Z');
  assert.equal(followingEvening.locations[0].isOrderingOpen, false);
}

// Same-day times before an overnight slot starts are not part of that slot.
{
  const foodTruck = makeFoodTruck({
    availability: [
      {
        day: 'tue',
        locationId: 'location-1',
        truckUnitId: 'unit-1',
        startTime: '22:00',
        endTime: '02:00',
        available: true,
      },
    ],
  });

  reconcile(foodTruck, '2026-08-04T05:00:00.000Z');
  assert.equal(foodTruck.locations[0].isOrderingOpen, false);
}

// Adjacent Wednesday slots close and reopen at the displayed times without an
// early-close buffer.
{
  const availability = [
    {
      day: 'wed',
      locationId: 'location-1',
      truckUnitId: 'unit-1',
      startTime: '17:00',
      endTime: '19:00',
      available: true,
    },
    {
      day: 'wed',
      locationId: 'location-1',
      truckUnitId: 'unit-1',
      startTime: '19:30',
      endTime: '00:00',
      available: true,
    },
  ];

  const beforeClose = makeFoodTruck({ availability });
  reconcile(beforeClose, '2026-08-05T22:59:00.000Z');
  assert.equal(beforeClose.locations[0].isOrderingOpen, true);

  const betweenSlots = makeFoodTruck({ availability });
  reconcile(betweenSlots, '2026-08-05T23:00:00.000Z');
  assert.equal(betweenSlots.locations[0].isOrderingOpen, false);

  const reopened = makeFoodTruck({ availability });
  reconcile(reopened, '2026-08-05T23:30:00.000Z');
  assert.equal(reopened.locations[0].isOrderingOpen, true);
}

{
  const foodTruck = makeFoodTruck({
    availability: [
      {
        day: 'wed',
        locationId: 'location-1',
        truckUnitId: 'unit-1',
        startTime: '09:00',
        endTime: '17:00',
        available: true,
      },
    ],
    openLocations: [
      {
        locationId: 'location-1',
        isOrderingOpen: false,
        status_source: 'MANUAL',
        schedule_override_until: '2026-07-30T08:00:00.000Z',
      },
    ],
  });

  const result = reconcile(foodTruck, '2026-07-29T14:00:00.000Z');
  assert.equal(result.manualOverridePairs, 1);
  assert.equal(foodTruck.locations[0].isOrderingOpen, false);
}

console.log('vendor schedule state tests passed');
