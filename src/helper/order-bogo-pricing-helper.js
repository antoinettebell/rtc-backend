const roundCurrency = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const calculateRuleBasedBogoPricing = ({
  primaryUnitPrice,
  quantity,
  rewardBasePrice,
  rewardOptionsCost,
  discountRules,
}) => {
  const paidQuantity = Math.max(0, Number(quantity) || 0);
  const buyQty = Math.max(1, Number(discountRules?.buyQty) || 1);
  const getQty = Math.max(1, Number(discountRules?.getQty) || 1);
  const discount = Math.min(1, Math.max(0, Number(discountRules?.discount) || 0));
  const eligibleSets = discountRules?.repeatable === false
    ? paidQuantity >= buyQty ? 1 : 0
    : Math.floor(paidQuantity / buyQty);
  const rewardQuantity = eligibleSets * getQty;
  const paidTotal = (Number(primaryUnitPrice) || 0) * paidQuantity;
  const rewardBase = Number(rewardBasePrice) || 0;
  const modifiers = Number(rewardOptionsCost) || 0;
  const rewardUnitPrice = rewardBase * (1 - discount) + modifiers;

  return {
    rewardQuantity,
    rewardUnitPrice,
    totalBeforeRounding: paidTotal + rewardQuantity * rewardUnitPrice,
  };
};

module.exports = { calculateRuleBasedBogoPricing, roundCurrency };
