const assert = require('assert');
const {
  getDiscountSourceItem,
  hasDiscountReward,
} = require('./order-discount-helper');

const regularCombo = {
  itemType: 'COMBO',
  discountType: 'FIXED',
  discountRules: { discount: 0 },
  bogoItems: [],
};

assert.equal(hasDiscountReward(regularCombo), false);
assert.equal(getDiscountSourceItem(regularCombo), null);

const ruleDiscount = {
  itemType: 'COMBO',
  discountRules: { discount: 0.5 },
  bogoItems: [],
};
assert.equal(getDiscountSourceItem(ruleDiscount), ruleDiscount);

const rewardItem = { _id: 'reward-item', itemType: 'COMBO' };
const bogoDiscount = {
  discountType: 'BOGO',
  discountRules: { discount: 0 },
  bogoItems: [{ ...rewardItem, isSameItem: false }],
};
assert.equal(getDiscountSourceItem(bogoDiscount)._id, 'reward-item');

console.log('order discount helper tests passed');
