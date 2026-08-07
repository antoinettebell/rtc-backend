const getMarketplaceBudgetGuestCount = (event = {}) => {
  const regularGuests = Math.max(0, Number(event.number_of_guests || 0));
  const vipGuests = Math.max(0, Number(event.vip_guest_count || 0));
  if (event.fully_catered_event) return regularGuests + vipGuests;
  if (event.catered_vip_section_enabled) return vipGuests;
  return regularGuests;
};

const getAllowedBidCoverages = (event = {}) => {
  if (event.fully_catered_event) {
    const hasRegularGuests = Number(event.number_of_guests || 0) > 0;
    const hasVipGuests = Number(event.vip_guest_count || 0) > 0;
    if (hasRegularGuests && hasVipGuests) return ['REGULAR', 'VIP', 'BOTH'];
    if (hasVipGuests) return ['VIP'];
    return ['REGULAR'];
  }
  if (event.catered_vip_section_enabled) {
    return event.ga_food_sales_allowed ? ['VIP', 'BOTH'] : ['VIP'];
  }
  return ['REGULAR'];
};

module.exports = {
  getAllowedBidCoverages,
  getMarketplaceBudgetGuestCount,
};
