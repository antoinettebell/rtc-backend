const ACTIVE_BOGO_TYPES = ['BOGO', 'BOGOHO'];

const hasActiveBogoPromotion = (item = {}) =>
  item.hasDiscount === true && ACTIVE_BOGO_TYPES.includes(item.discountType);

const getComboSubItemId = (subItem = {}) =>
  subItem?.menuItem?._id ||
  subItem?.menuItem ||
  subItem?.itemId?._id ||
  subItem?.itemId ||
  subItem?._id;

module.exports = {
  ACTIVE_BOGO_TYPES,
  getComboSubItemId,
  hasActiveBogoPromotion,
};
