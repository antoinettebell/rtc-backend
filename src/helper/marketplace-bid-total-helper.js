const roundMoney = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;

const hasService = (bid = {}, service) =>
  Array.isArray(bid.specialty_services) && bid.specialty_services.includes(service);

const calculateMarketplaceBidTotal = (bid = {}) => {
  const baseAmount = roundMoney(bid.full_bid_amount);
  const dessertsAmount = hasService(bid, 'DESSERTS')
    ? roundMoney(bid.dessert_bid_amount)
    : 0;
  const drinksAmount = hasService(bid, 'DRINKS')
    ? roundMoney(bid.drinks_bid_amount)
    : 0;

  return roundMoney(baseAmount + dessertsAmount + drinksAmount);
};

const getMarketplaceBidTotal = (bid = {}) =>
  bid.total_bid_amount == null
    ? calculateMarketplaceBidTotal(bid)
    : roundMoney(bid.total_bid_amount);

module.exports = {
  calculateMarketplaceBidTotal,
  getMarketplaceBidTotal,
  roundMoney,
};
