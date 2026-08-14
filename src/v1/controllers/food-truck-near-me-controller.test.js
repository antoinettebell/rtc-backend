const assert = require('assert');

const services = require('../services');
const VendorComplianceService = require('../services/vendor-compliance-service');

const originals = {
  getWithFiltersNew: services.FoodTruckService.getWithFiltersNew,
  getEvents: services.MarketplaceEventService.getByData,
  getEventImages: services.MarketplaceEventImageService.getByData,
  getSanitationGrades: VendorComplianceService.getSanitationGradeMap,
};

const run = async () => {
  let capturedArguments;
  services.FoodTruckService.getWithFiltersNew = async (...args) => {
    capturedArguments = args;
    return {
      data: [{
        _id: 'food-truck-1',
        name: 'Jazzy Fried Rice',
        menu: [],
        cuisine: [],
        locations: [],
        truck_units: [],
        location: {
          _id: 'san-francisco-location',
          address: 'San Francisco, CA',
          lat: '37.7749',
          long: '-122.4194',
          isOrderingOpen: true,
        },
        distanceInMeters: 0,
      }, {
        _id: 'food-truck-2',
        name: 'Far Away Vendor',
        menu: [],
        cuisine: [],
        locations: [],
        truck_units: [],
        location: {
          _id: 'new-york-location',
          address: 'New York, NY',
          lat: '40.7128',
          long: '-74.0060',
          isOrderingOpen: true,
        },
        distanceInMeters: 4129000,
      }],
      total: 2,
    };
  };
  services.MarketplaceEventService.getByData = async () => [];
  services.MarketplaceEventImageService.getByData = async () => [];
  VendorComplianceService.getSanitationGradeMap = async () => ({});

  delete require.cache[require.resolve('./food-truck-controller')];
  const controller = require('./food-truck-controller');
  let payload;
  let forwardedError;
  await controller.nearMe(
    {
      query: {
        type: 'FOOD',
        userLat: '37.7749',
        userLong: '-122.4194',
        distanceInMeters: '32186.9',
        page: 1,
        limit: 50,
      },
      user: { _id: 'customer-1', userType: 'CUSTOMER' },
    },
    {
      data(value) {
        payload = value;
        return value;
      },
    },
    (error) => { forwardedError = error; },
  );

  assert.equal(forwardedError, undefined);
  assert.equal(capturedArguments[11], true, 'Near Me must include vendors without menus');
  assert.equal(payload.nearMeList.length, 1);
  assert.equal(payload.nearMeList[0].food_truck_name, 'Jazzy Fried Rice');
  assert.deepEqual(payload.nearMeList[0].raw.menu, []);
};

run()
  .finally(() => {
    services.FoodTruckService.getWithFiltersNew = originals.getWithFiltersNew;
    services.MarketplaceEventService.getByData = originals.getEvents;
    services.MarketplaceEventImageService.getByData = originals.getEventImages;
    VendorComplianceService.getSanitationGradeMap = originals.getSanitationGrades;
  })
  .then(() => console.log('Customer Near Me menu-independent vendor test passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
