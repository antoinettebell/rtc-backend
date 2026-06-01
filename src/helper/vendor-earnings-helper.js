const VENDOR_TIER_RATES = {
  SUB_BASIC: 3.5,
  BASIC: 3.5,
  SUB_PLATINUM: 4.5,
  PLATINUM: 4.5,
  SUB_ELITE: 5.5,
  ELITE: 5.5,
};

const toMoneyNumber = (value, fallback = 0) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : fallback;
};

const roundMoney = (value) => Number(toMoneyNumber(value).toFixed(2));

const resolveVendorTierRate = (tier, fallbackRate = 0) => {
  const rawRate = Number(tier?.rate);
  if (Number.isFinite(rawRate)) {
    return Math.max(0, rawRate);
  }

  const tierKey = `${tier?.slug || tier?.name || ''}`.trim().toUpperCase();
  return VENDOR_TIER_RATES[tierKey] || toMoneyNumber(fallbackRate);
};

const getVendorEarningsFoodSalesBase = (order) => {
  const subtotal = order?.subTotal ?? order?.subtotal;
  if (subtotal !== undefined && subtotal !== null && subtotal !== '') {
    return toMoneyNumber(subtotal);
  }

  return toMoneyNumber(order?.totalAfterDiscount) + toMoneyNumber(order?.discount);
};

const toNumberExpression = (input, fallback = 0) => ({
  $convert: {
    input,
    to: 'double',
    onError: fallback,
    onNull: fallback,
  },
});

const calculateVendorEarnings = (order, fallbackRate = 0) => {
  const foodSalesBase = getVendorEarningsFoodSalesBase(order);
  const foodTruckTip = toMoneyNumber(order?.tipsAmount);
  const tierRate = resolveVendorTierRate(
    order?.vendor_tier_at_transaction,
    fallbackRate
  );
  const tierFee = roundMoney((foodSalesBase * tierRate) / 100);

  return {
    foodSalesBase: roundMoney(foodSalesBase),
    foodTruckTip: roundMoney(foodTruckTip),
    tierRate,
    tierFee,
    vendorEarnings: roundMoney(foodSalesBase + foodTruckTip - tierFee),
  };
};

const vendorFoodSalesBaseExpression = {
  $cond: [
    {
      $and: [
        { $ne: ['$subTotal', null] },
        { $ne: ['$subTotal', ''] },
      ],
    },
    toNumberExpression('$subTotal'),
    {
      $cond: [
        {
          $and: [
            { $ne: ['$subtotal', null] },
            { $ne: ['$subtotal', ''] },
          ],
        },
        toNumberExpression('$subtotal'),
        {
          $add: [
            toNumberExpression('$totalAfterDiscount'),
            toNumberExpression('$discount'),
          ],
        },
      ],
    },
  ],
};

const buildVendorTierRateExpression = (fallbackRate = 0) => ({
  $convert: {
    input: '$vendor_tier_at_transaction.rate',
    to: 'double',
    onError: toMoneyNumber(fallbackRate),
    onNull: toMoneyNumber(fallbackRate),
  },
});

const buildVendorEarningExpression = (fallbackRate = 0) => {
  const tierRateExpression = buildVendorTierRateExpression(fallbackRate);
  const tierFeeExpression = {
    $multiply: [
      vendorFoodSalesBaseExpression,
      { $divide: [tierRateExpression, 100] },
    ],
  };

  return {
    $subtract: [
      {
        $add: [
          vendorFoodSalesBaseExpression,
          toNumberExpression('$tipsAmount'),
        ],
      },
      tierFeeExpression,
    ],
  };
};

module.exports = {
  calculateVendorEarnings,
  resolveVendorTierRate,
  buildVendorEarningExpression,
  vendorFoodSalesBaseExpression,
};
