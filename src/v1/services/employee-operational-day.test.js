const assert = require('assert');
const {
  getOperationalDayKey,
  isOperationalDayInRange,
} = require('../../helper/employee-operational-day-helper');

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
assert.strictEqual(
  getOperationalDayKey('2026-07-28T08:00:00Z', 'Not/A_Timezone'),
  '2026-07-28'
);

assert.strictEqual(
  isOperationalDayInRange({
    value: '2026-09-13T07:59:59Z',
    startDayKey: '2026-09-13',
    endDayKey: '2026-09-19',
    timeZone: 'America/New_York',
  }),
  false,
  'work before the 4 AM cutoff remains in the prior operational week'
);
assert.strictEqual(
  isOperationalDayInRange({
    value: '2026-09-13T08:00:00Z',
    startDayKey: '2026-09-13',
    endDayKey: '2026-09-19',
    timeZone: 'America/New_York',
  }),
  true,
  'the Sunday through Saturday week begins Sunday at 4 AM'
);
assert.strictEqual(
  isOperationalDayInRange({
    operationalDayKey: '2026-09-19',
    startDayKey: '2026-09-13',
    endDayKey: '2026-09-19',
  }),
  true,
  'stored operational day keys use the selected summary period'
);

console.log('employee operational-day tests passed');
