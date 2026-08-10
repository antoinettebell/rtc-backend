const assert = require('assert');
const path = require('path');
const fs = require('fs');

const services = require('../services');
const originalGetByData = services.FoodTruckService.getByData;

const run = async () => {
  const item = {
    _id: 'food-truck-1',
    userId: 'vendor-1',
    name: 'Fallback Truck Name',
    truck_units: [],
    saveCalled: false,
    async save() { this.saveCalled = true; return this; },
  };
  let calls = 0;
  services.FoodTruckService.getByData = async () => {
    calls += 1;
    return item;
  };
  delete require.cache[require.resolve('./food-truck-controller')];
  const controller = require('./food-truck-controller');
  let responsePayload = null;
  let forwardedError = null;
  await controller.update(
    {
      body: {},
      params: { id: item._id },
      user: { _id: item.userId, userType: 'VENDOR' },
    },
    {
      data(payload) { responsePayload = payload; return payload; },
      error(error) { throw error; },
    },
    (error) => { forwardedError = error; },
  );

  assert.strictEqual(forwardedError, null, 'general update must not leak a ReferenceError');
  assert.strictEqual(item.saveCalled, true);
  assert.strictEqual(calls, 2);
  assert.strictEqual(item.truck_units.length, 1);
  assert.strictEqual(item.truck_units[0].name, 'Fallback Truck Name');
  assert.strictEqual(item.truck_units[0].is_primary, true);
  assert(responsePayload?.foodtruck);

  const source = fs.readFileSync(path.join(__dirname, 'food-truck-controller.js'), 'utf8');
  const generalUpdate = source.slice(source.indexOf('exports.update ='), source.indexOf('exports.addDocument ='));
  const truckUnitUpdate = source.slice(source.indexOf('exports.updateTruckUnits ='), source.indexOf('exports.updateTruckUnit ='));
  assert.doesNotMatch(generalUpdate, /create_name/);
  assert.match(truckUnitUpdate, /body: \{ food_truck_count, create_name, reactivate_truck_unit_id \}/);
  assert.match(truckUnitUpdate, /createTruckUnit\(item, create_name, phoneDigits\)/);
  console.log('food truck general update regression tests passed');
};

run()
  .finally(() => { services.FoodTruckService.getByData = originalGetByData; })
  .catch((error) => { console.error(error); process.exitCode = 1; });
