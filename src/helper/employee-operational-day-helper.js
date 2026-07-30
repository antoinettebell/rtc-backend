const getOperationalDayKey = (value = new Date(), timeZone = 'America/New_York') => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
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

module.exports = { getOperationalDayKey };
