const assert = require('assert');
const { getOperationalDayKey } = require('../../helper/employee-operational-day-helper');

assert.strictEqual(
  getOperationalDayKey('2026-07-28T07:59:59Z', 'America/New_York'),
  '2026-07-27'
);
assert.strictEqual(
  getOperationalDayKey('2026-07-28T08:00:00Z', 'America/New_York'),
  '2026-07-28'
);
assert.strictEqual(
  getOperationalDayKey('2026-03-08T07:59:59Z', 'America/New_York'),
  '2026-03-07'
);
assert.strictEqual(
  getOperationalDayKey('2026-03-08T08:00:00Z', 'America/New_York'),
  '2026-03-08'
);
assert.strictEqual(
  getOperationalDayKey('2026-11-01T08:59:59Z', 'America/New_York'),
  '2026-10-31'
);
assert.strictEqual(
  getOperationalDayKey('2026-11-01T09:00:00Z', 'America/New_York'),
  '2026-11-01'
);

console.log('employee operational-day tests passed');
