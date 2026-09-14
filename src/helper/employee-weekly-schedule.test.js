const assert = require('assert');
const {
  getEmployeeScheduleState,
  getEmployeeScheduleAssignment,
  getEffectiveEmployeeAssignment,
  getEmployeeScheduledEndAt,
  isEmployeeScheduledToday,
  findOverlappingScheduleAssignment,
} = require('./employee-weekly-schedule');

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
assert.equal(
  getEmployeeScheduledEndAt({
    employee: { weekly_schedule: monday },
    session: { started_at: '2026-08-03T09:02:00Z' },
    now: new Date('2026-08-03T18:00:00Z'),
    timeZone: 'UTC',
  }).toISOString(),
  '2026-08-03T17:00:00.000Z'
);
assert.equal(
  getEmployeeScheduledEndAt({
    employee: { weekly_schedule: overnight },
    session: { started_at: '2026-08-03T19:50:00Z' },
    now: new Date('2026-08-04T03:00:00Z'),
    timeZone: 'UTC',
  }).toISOString(),
  '2026-08-04T02:00:00.000Z'
);
assert.equal(
  getEmployeeScheduledEndAt({
    employee: { weekly_schedule: monday },
    session: { started_at: '2026-08-03T09:02:00Z' },
    now: new Date('2026-08-03T16:00:00Z'),
    timeZone: 'UTC',
  }),
  null,
  'a future scheduled clock-out is not used'
);
assert.equal(
  getEmployeeScheduledEndAt({
    employee: {
      schedule_assignments: [{
        days: [{ day: 'sun', enabled: true, clock_in: '22:00', clock_out: '01:00' }],
      }],
    },
    session: { started_at: '2026-09-14T02:34:00Z' },
    now: new Date('2026-09-14T05:27:00Z'),
    timeZone: 'America/New_York',
  }).toISOString(),
  '2026-09-14T05:00:00.000Z',
  'an overnight shift closes at the saved local clock-out time'
);

const assignments = [
  { truck_unit_id: 'truck-a', location_id: 'location-a', days: monday },
  {
    truck_unit_id: 'truck-b',
    location_id: 'location-b',
    days: [{ day: 'wed', enabled: true, clock_in: '10:00', clock_out: '14:00' }],
  },
];
assert.equal(
  getEmployeeScheduleAssignment(assignments, new Date('2026-08-05T10:30:00Z'), 'UTC')
    .assignment.truck_unit_id,
  'truck-b'
);

const effective = getEffectiveEmployeeAssignment({
  employee: {
    assigned_location_id: 'legacy-location',
    assigned_truck_unit_id: 'legacy-truck',
    schedule_assignments: assignments,
  },
  now: new Date('2026-08-05T10:30:00Z'),
  timeZone: 'UTC',
});
assert.equal(effective.locationId, assignments[1].location_id);
assert.equal(effective.truckUnitId, assignments[1].truck_unit_id);

const legacyEffective = getEffectiveEmployeeAssignment({
  employee: {
    assigned_location_id: 'legacy-location',
    assigned_truck_unit_id: 'legacy-truck',
    schedule_assignments: [],
  },
});
assert.equal(legacyEffective.locationId, 'legacy-location');
assert.equal(legacyEffective.truckUnitId, 'legacy-truck');
assert.equal(
  getEmployeeScheduleAssignment(assignments, new Date('2026-08-06T10:30:00Z'), 'UTC'),
  null
);
assert.equal(
  isEmployeeScheduledToday({ weekly_schedule: monday }, new Date('2026-08-03T23:00:00Z'), 'UTC'),
  true
);
assert.equal(
  isEmployeeScheduledToday({ weekly_schedule: monday }, new Date('2026-08-04T23:00:00Z'), 'UTC'),
  false
);

const splitDayAssignments = [
  { truck_unit_id: 'truck-a', location_id: 'location-a', days: [{ day: 'tue', enabled: true, clock_in: '09:00', clock_out: '13:00' }] },
  { truck_unit_id: 'truck-b', location_id: 'location-b', days: [{ day: 'tue', enabled: true, clock_in: '13:00', clock_out: '17:00' }] },
];
assert.equal(
  findOverlappingScheduleAssignment(splitDayAssignments),
  null,
  'back-to-back shifts on different trucks are allowed'
);
assert.equal(
  getEmployeeScheduleAssignment(
    splitDayAssignments,
    new Date('2026-08-04T13:00:00Z'),
    'UTC'
  ).assignment.truck_unit_id,
  'truck-b',
  'a back-to-back handoff selects the later truck at its scheduled start'
);
assert.ok(
  findOverlappingScheduleAssignment([
    splitDayAssignments[0],
    { truck_unit_id: 'truck-b', location_id: 'location-b', days: [{ day: 'tue', enabled: true, clock_in: '12:30', clock_out: '17:00' }] },
  ]),
  'overlapping shifts on the same day are rejected'
);
assert.ok(
  findOverlappingScheduleAssignment([
    { truck_unit_id: 'truck-a', location_id: 'location-a', days: [{ day: 'sat', enabled: true, clock_in: '22:00', clock_out: '02:00' }] },
    { truck_unit_id: 'truck-b', location_id: 'location-b', days: [{ day: 'sun', enabled: true, clock_in: '01:00', clock_out: '05:00' }] },
  ]),
  'overnight shifts cannot overlap a next-day assignment'
);

console.log('employee weekly schedule tests passed');
