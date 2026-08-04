const assert = require('assert');
const { getEmployeeScheduleState } = require('./employee-weekly-schedule');

const monday = [{ day: 'mon', enabled: true, clock_in: '09:00', clock_out: '17:00' }];
const isAllowed = (schedule, iso) =>
  getEmployeeScheduleState(schedule, new Date(iso), 'UTC').withinWindow;

assert.equal(isAllowed(monday, '2026-08-03T08:44:00Z'), false);
assert.equal(isAllowed(monday, '2026-08-03T08:45:00Z'), true);
assert.equal(isAllowed(monday, '2026-08-03T17:15:00Z'), true);
assert.equal(isAllowed(monday, '2026-08-03T17:16:00Z'), false);

const overnight = [{ day: 'mon', enabled: true, clock_in: '20:00', clock_out: '02:00' }];
assert.equal(isAllowed(overnight, '2026-08-03T19:45:00Z'), true);
assert.equal(isAllowed(overnight, '2026-08-04T02:15:00Z'), true);
assert.equal(isAllowed(overnight, '2026-08-04T02:16:00Z'), false);

console.log('employee weekly schedule tests passed');
