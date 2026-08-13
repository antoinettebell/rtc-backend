const toCountMap = (counts = []) => counts.reduce((result, item) => {
  result[item._id] = Number(item.total || 0);
  return result;
}, {});

const getMarketplaceApplicationCounts = ({
  eventId,
  foodApplicationCounts = [],
  eventVendorApplicationCounts = [],
}) => {
  const foodByEventId = toCountMap(foodApplicationCounts);
  const eventVendorByEventId = toCountMap(eventVendorApplicationCounts);
  const foodApplicationCount = foodByEventId[eventId] || 0;
  const eventVendorApplicationCount = eventVendorByEventId[eventId] || 0;

  return {
    food_application_count: foodApplicationCount,
    event_vendor_application_count: eventVendorApplicationCount,
    application_count: foodApplicationCount + eventVendorApplicationCount,
  };
};

module.exports = { getMarketplaceApplicationCounts };
