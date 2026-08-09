const { getMarketplaceEventTiming } = require('./marketplace-event-close-helper');

const isMarketplaceEventExpired = (event = {}, now = new Date()) => {
  const timing = getMarketplaceEventTiming(event);
  if (!timing) return false;
  return timing.end_at.getTime() < new Date(now).getTime();
};

const filterActivePublicMarketplaceEvents = (events = [], now = new Date()) =>
  events.filter((event) => !isMarketplaceEventExpired(event, now));

module.exports = { filterActivePublicMarketplaceEvents, isMarketplaceEventExpired };
