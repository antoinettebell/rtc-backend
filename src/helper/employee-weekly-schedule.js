const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const EARLY_MINUTES = 15;
const LATE_MINUTES = 15;

const parseTime = (value) => {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const getZonedParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { dayIndex: DAY_KEYS.indexOf(String(parts.weekday || '').slice(0, 3).toLowerCase()), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};

const getEmployeeScheduleState = (schedule = [], now = new Date(), timeZone = 'America/New_York') => {
  const { dayIndex, minutes } = getZonedParts(now, timeZone);
  const entries = new Map((schedule || []).map((entry) => [entry.day, entry]));
  const today = entries.get(DAY_KEYS[dayIndex]);
  const yesterday = entries.get(DAY_KEYS[(dayIndex + 6) % 7]);
  const inToday = (() => {
    if (!today?.enabled) return false;
    const start = parseTime(today.clock_in);
    const end = parseTime(today.clock_out);
    if (start === null || end === null) return false;
    return end > start
      ? minutes >= Math.max(0, start - EARLY_MINUTES) && minutes <= end + LATE_MINUTES
      : minutes >= Math.max(0, start - EARLY_MINUTES);
  })();
  const inYesterday = (() => {
    if (!yesterday?.enabled) return false;
    const start = parseTime(yesterday.clock_in);
    const end = parseTime(yesterday.clock_out);
    return start !== null && end !== null && end <= start && minutes <= end + LATE_MINUTES;
  })();
  return { withinWindow: inToday || inYesterday, earlyMinutes: EARLY_MINUTES, lateMinutes: LATE_MINUTES };
};

const getEmployeeScheduleAssignment = (
  assignments = [],
  now = new Date(),
  timeZone = 'America/New_York'
) => {
  for (const assignment of assignments || []) {
    const state = getEmployeeScheduleState(assignment.days || [], now, timeZone);
    if (state.withinWindow) return { assignment, ...state };
  }
  return null;
};

const getEffectiveEmployeeAssignment = ({
  employee,
  now = new Date(),
  timeZone = 'America/New_York',
}) => {
  const assignments = Array.isArray(employee?.schedule_assignments)
    ? employee.schedule_assignments
    : [];
  const scheduled = assignments.length
    ? getEmployeeScheduleAssignment(assignments, now, timeZone)
    : null;
  const fallbackAssignment = assignments.find(
    (assignment) => assignment?.location_id && assignment?.truck_unit_id
  );
  const assignment = scheduled?.assignment || fallbackAssignment || null;

  return {
    assignment,
    withinWindow: !!scheduled?.withinWindow,
    locationId: assignment?.location_id || employee?.assigned_location_id || null,
    truckUnitId:
      assignment?.truck_unit_id || employee?.assigned_truck_unit_id || null,
  };
};

module.exports = {
  DAY_KEYS,
  EARLY_MINUTES,
  LATE_MINUTES,
  parseTime,
  getEmployeeScheduleState,
  getEmployeeScheduleAssignment,
  getEffectiveEmployeeAssignment,
};
