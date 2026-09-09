const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const EARLY_MINUTES = 15;
const LATE_MINUTES = 15;

const parseTime = (value) => {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const getScheduleIntervals = (assignments = []) =>
  (assignments || []).flatMap((assignment, assignmentIndex) =>
    (assignment?.days || []).flatMap((entry) => {
      if (!entry?.enabled) return [];
      const dayIndex = DAY_KEYS.indexOf(entry.day);
      const startMinutes = parseTime(entry.clock_in);
      const endMinutes = parseTime(entry.clock_out);
      if (dayIndex < 0 || startMinutes === null || endMinutes === null) return [];

      const start = dayIndex * 24 * 60 + startMinutes;
      let end = dayIndex * 24 * 60 + endMinutes;
      if (end <= start) end += 24 * 60;
      return [{ assignmentIndex, day: entry.day, start, end }];
    })
  );

// A weekly schedule repeats, so compare neighboring weeks as well. This
// catches an overnight Saturday shift that overlaps an early-Sunday shift.
const findOverlappingScheduleAssignment = (assignments = []) => {
  const intervals = getScheduleIntervals(assignments);
  const weekMinutes = 7 * 24 * 60;
  for (let leftIndex = 0; leftIndex < intervals.length; leftIndex += 1) {
    const left = intervals[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < intervals.length; rightIndex += 1) {
      const right = intervals[rightIndex];
      for (const weekOffset of [-weekMinutes, 0, weekMinutes]) {
        const rightStart = right.start + weekOffset;
        const rightEnd = right.end + weekOffset;
        if (left.start < rightEnd && rightStart < left.end) {
          return { left, right };
        }
      }
    }
  }
  return null;
};

const getZonedParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { dayIndex: DAY_KEYS.indexOf(String(parts.weekday || '').slice(0, 3).toLowerCase()), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
};

const isEmployeeScheduledToday = (
  employee = {},
  now = new Date(),
  timeZone = 'America/New_York'
) => {
  const { dayIndex } = getZonedParts(now, timeZone);
  const day = DAY_KEYS[dayIndex];
  const assignments = Array.isArray(employee.schedule_assignments)
    ? employee.schedule_assignments
    : [];
  const schedules = assignments.length
    ? assignments.map((assignment) => assignment.days || [])
    : [employee.weekly_schedule || []];

  return schedules.some((schedule) =>
    schedule.some((entry) => entry?.day === day && entry?.enabled)
  );
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

const isWithinScheduledShift = (
  schedule = [],
  now = new Date(),
  timeZone = 'America/New_York'
) => {
  const { dayIndex, minutes } = getZonedParts(now, timeZone);
  const entries = new Map((schedule || []).map((entry) => [entry.day, entry]));
  const today = entries.get(DAY_KEYS[dayIndex]);
  const yesterday = entries.get(DAY_KEYS[(dayIndex + 6) % 7]);
  const isInTodayShift = (() => {
    if (!today?.enabled) return false;
    const start = parseTime(today.clock_in);
    const end = parseTime(today.clock_out);
    if (start === null || end === null) return false;
    return end > start ? minutes >= start && minutes < end : minutes >= start;
  })();
  const isInYesterdayOvernightShift = (() => {
    if (!yesterday?.enabled) return false;
    const start = parseTime(yesterday.clock_in);
    const end = parseTime(yesterday.clock_out);
    return start !== null && end !== null && end <= start && minutes < end;
  })();
  return isInTodayShift || isInYesterdayOvernightShift;
};

const getEmployeeScheduleAssignment = (
  assignments = [],
  now = new Date(),
  timeZone = 'America/New_York'
) => {
  // Prefer the exact scheduled window before applying the clock-in grace
  // window. This makes a back-to-back handoff select the later truck exactly
  // at its start time instead of keeping the prior truck through its grace.
  for (const assignment of assignments || []) {
    if (isWithinScheduledShift(assignment.days || [], now, timeZone)) {
      return {
        assignment,
        ...getEmployeeScheduleState(assignment.days || [], now, timeZone),
      };
    }
  }
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
  findOverlappingScheduleAssignment,
  getEmployeeScheduleState,
  isWithinScheduledShift,
  getEmployeeScheduleAssignment,
  getEffectiveEmployeeAssignment,
  isEmployeeScheduledToday,
};
