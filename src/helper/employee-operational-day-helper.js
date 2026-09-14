const getOperationalDayKey = (value = new Date(), timeZone = 'America/New_York') => {
  let safeTimeZone = timeZone || 'America/New_York';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone }).format();
  } catch (error) {
    safeTimeZone = 'America/New_York';
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const localDate = new Date(Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day)
  ));
  if (Number(parts.hour) < 4) localDate.setUTCDate(localDate.getUTCDate() - 1);
  return localDate.toISOString().slice(0, 10);
};

const isOperationalDayInRange = ({
  value,
  operationalDayKey,
  startDayKey,
  endDayKey,
  timeZone = 'America/New_York',
}) => {
  const dayKey = operationalDayKey || getOperationalDayKey(value, timeZone);
  return dayKey >= startDayKey && dayKey <= endDayKey;
};

const getOperationalDayQueryEnvelope = (startDayKey, endDayKey = startDayKey) => {
  const start = new Date(`${startDayKey}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${endDayKey}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  return { start, end };
};

module.exports = {
  getOperationalDayKey,
  getOperationalDayQueryEnvelope,
  isOperationalDayInRange,
};
