const VENDOR_PLAN_TIERS = {
  SUB_BASIC: {
    name: 'Basic',
    rate: 3.5,
    rateType: '/vendor-side tier rate',
    payoutTimingLabel: '3-day payout',
    details: [
      'Marketplace ordering',
      'Delivery acceptance',
      'Preorder ordering',
      'QR ordering',
      'Printing',
      'Basic reporting',
      '1 media link and 1 social/website link',
      '3-day payouts',
      'No employee login',
      'No walk-up POS',
      'No Tap to Pay',
    ],
    capabilities: {
      payoutTiming: 'THREE_DAY',
      deliveryAcceptance: true,
      employeeLogin: false,
      employeeWalkUpPos: false,
      walkUpPosPaymentMethods: [],
      tapToPay: false,
      eventMarketplace: false,
      maxSocialMediaLinks: 1,
      newDishHighlight: false,
    },
  },
  SUB_PLATINUM: {
    name: 'Platinum',
    rate: 4.5,
    rateType: '/vendor-side tier rate',
    payoutTimingLabel: 'Daily payout',
    details: [
      'All Basic features',
      'Employee Login/Cashier Mode',
      'Walk-up POS for Cash Payments Only',
      'Daily payouts',
      'Advanced reporting',
      '2 media links and 2 social/website links',
      'No highlight new dishes',
      'No Tap to Pay',
    ],
    capabilities: {
      payoutTiming: 'DAILY',
      deliveryAcceptance: true,
      employeeLogin: true,
      employeeWalkUpPos: true,
      walkUpPosPaymentMethods: ['CASH'],
      tapToPay: false,
      eventMarketplace: false,
      maxSocialMediaLinks: 2,
      newDishHighlight: false,
    },
  },
  SUB_ELITE: {
    name: 'Elite',
    rate: 5.5,
    rateType: '/vendor-side tier rate',
    payoutTimingLabel: 'Daily payout',
    details: [
      'All Platinum features',
      'Ability to highlight dishes',
      'Tap to Pay enabled',
      'Event marketplace included',
      'Customizable reporting',
      '4 media/social/website links',
    ],
    capabilities: {
      payoutTiming: 'DAILY',
      deliveryAcceptance: true,
      employeeLogin: true,
      employeeWalkUpPos: true,
      walkUpPosPaymentMethods: ['CASH', 'TAP_TO_PAY'],
      tapToPay: true,
      eventMarketplace: true,
      maxSocialMediaLinks: 4,
      newDishHighlight: true,
    },
  },
};

const getVendorPlanTier = (plan) => {
  if (!plan) {
    return null;
  }

  const source = typeof plan.toObject === 'function' ? plan.toObject() : plan;
  return VENDOR_PLAN_TIERS[source.slug] || null;
};

const getVendorPlanCapabilities = (plan) => {
  const tier = getVendorPlanTier(plan);
  return tier?.capabilities || {};
};

const canUseEmployeeLogin = (foodTruckOrPlan) =>
  !!getVendorPlanCapabilities(foodTruckOrPlan?.plan || foodTruckOrPlan?.planId || foodTruckOrPlan)
    .employeeLogin;

const canUseWalkupPOS = (foodTruckOrPlan) =>
  !!getVendorPlanCapabilities(foodTruckOrPlan?.plan || foodTruckOrPlan?.planId || foodTruckOrPlan)
    .employeeWalkUpPos;

const canUseCashPOS = (foodTruckOrPlan) =>
  (getVendorPlanCapabilities(foodTruckOrPlan?.plan || foodTruckOrPlan?.planId || foodTruckOrPlan)
    .walkUpPosPaymentMethods || []
  ).includes('CASH');

const canUseTapToPay = (foodTruckOrPlan) =>
  !!getVendorPlanCapabilities(foodTruckOrPlan?.plan || foodTruckOrPlan?.planId || foodTruckOrPlan)
    .tapToPay;

const hasEventMarketplaceAddOn = (foodTruck) =>
  Array.isArray(foodTruck?.addOns) &&
  foodTruck.addOns.some((addOn) => /event/i.test(addOn?.name || ''));

const canAccessEventMarketplace = (foodTruckOrPlan) =>
  !!getVendorPlanCapabilities(foodTruckOrPlan?.plan || foodTruckOrPlan?.planId || foodTruckOrPlan)
    .eventMarketplace || hasEventMarketplaceAddOn(foodTruckOrPlan);

const getPayoutSpeed = (foodTruckOrPlan) =>
  getVendorPlanCapabilities(foodTruckOrPlan?.plan || foodTruckOrPlan?.planId || foodTruckOrPlan)
    .payoutTiming || null;

const normalizeVendorPlan = (plan) => {
  if (!plan) {
    return plan;
  }

  const source = typeof plan.toObject === 'function' ? plan.toObject() : plan;
  const tier = getVendorPlanTier(source);

  if (!tier) {
    return source;
  }

  return {
    ...source,
    name: tier.name,
    rate: tier.rate,
    rateType: tier.rateType,
    details: tier.details,
    payoutTimingLabel: tier.payoutTimingLabel,
    capabilities: tier.capabilities,
  };
};

const buildCapabilityError = (message) => {
  const error = new Error(message);
  error.code = 403;
  return error;
};

const assertVendorPlanCapability = (plan, capability, message) => {
  const capabilities = getVendorPlanCapabilities(plan);

  if (!capabilities[capability]) {
    throw buildCapabilityError(
      message || 'Your current vendor plan does not include this feature.'
    );
  }

  return capabilities;
};

const assertWalkUpPosPaymentMethodAllowed = (plan, paymentMethod) => {
  const capabilities = assertVendorPlanCapability(
    plan,
    'employeeWalkUpPos',
    'Your current vendor plan does not include walk-up POS.'
  );

  const allowedMethods = capabilities.walkUpPosPaymentMethods || [];
  if (paymentMethod && !allowedMethods.includes(paymentMethod)) {
    throw buildCapabilityError(
      `${paymentMethod} is not available for your current vendor plan.`
    );
  }

  return capabilities;
};

const assertSocialMediaLinksAllowed = (plan, socialMedia = []) => {
  const capabilities = getVendorPlanCapabilities(plan);
  const maxLinks = Number(capabilities.maxSocialMediaLinks || 0);
  const linkCount = Array.isArray(socialMedia) ? socialMedia.length : 0;

  if (linkCount > maxLinks) {
    throw buildCapabilityError(
      `Your current vendor plan allows up to ${maxLinks} media/social links.`
    );
  }

  return capabilities;
};

const assertNewDishHighlightAllowed = (plan) =>
  assertVendorPlanCapability(
    plan,
    'newDishHighlight',
    'Your current vendor plan does not include new dish highlights.'
  );

module.exports = {
  VENDOR_PLAN_TIERS,
  canAccessEventMarketplace,
  canUseCashPOS,
  canUseEmployeeLogin,
  canUseTapToPay,
  canUseWalkupPOS,
  getPayoutSpeed,
  getVendorPlanCapabilities,
  normalizeVendorPlan,
  assertNewDishHighlightAllowed,
  assertSocialMediaLinksAllowed,
  assertVendorPlanCapability,
  assertWalkUpPosPaymentMethodAllowed,
};
