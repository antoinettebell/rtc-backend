const hasDiscountReward = (menuItem) =>
  Number(menuItem?.discountRules?.discount) > 0 ||
  ['BOGO', 'BOGOHO'].includes(menuItem?.discountType);

const getDiscountSourceItem = (menuItem) => {
  if (!hasDiscountReward(menuItem)) {
    return null;
  }

  const bogoItems = Array.isArray(menuItem?.bogoItems)
    ? menuItem.bogoItems
    : [];
  const sameItemReward = bogoItems.find((item) => item?.isSameItem);
  const differentItemReward = bogoItems.find((item) => !item?.isSameItem);

  if (
    sameItemReward ||
    (!bogoItems.length && Number(menuItem?.discountRules?.discount) > 0)
  ) {
    return menuItem;
  }

  return differentItemReward || menuItem;
};

module.exports = { getDiscountSourceItem, hasDiscountReward };
