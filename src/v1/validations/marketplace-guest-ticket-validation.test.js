const assert = require('assert');
const MarketplaceValidation = require('./marketplace-validation');

const validPurchaser = {
  first_name: 'Guest',
  last_name: 'Buyer',
  email: 'guest@example.com',
  phone: '+15555550123',
};
const validAddress = {
  line1: '1 Main Street',
  city: 'Buffalo',
  region: 'NY',
  postalCode: '14201',
  country: 'US',
};

const baseQuote = {
  ga_quantity: 1,
  vip_quantity: 0,
  purchaser: validPurchaser,
  billing_address: validAddress,
};

assert.equal(MarketplaceValidation.guestQuoteTickets.body.validate(baseQuote).error, undefined);
assert(MarketplaceValidation.guestQuoteTickets.body.validate({
  ...baseQuote,
  purchaser: { ...validPurchaser, email: 'not-an-email' },
}).error);
assert(MarketplaceValidation.guestQuoteTickets.body.validate({
  ...baseQuote,
  purchaser: undefined,
}).error);
assert(MarketplaceValidation.guestQuoteTickets.body.validate({
  ...baseQuote,
  ga_quantity: 0,
}).error);

const checkout = {
  ...baseQuote,
  payment_method: 'APPLE_PAY',
  payment_data: { token: 'wallet-token' },
  idempotency_key: '10f38a80-8ee6-4c10-a28c-03bd6254917a',
};
assert.equal(MarketplaceValidation.guestCheckoutTickets.body.validate(checkout).error, undefined);
assert(MarketplaceValidation.guestCheckoutTickets.body.validate({
  ...checkout,
  payment_method: 'CASH',
}).error);

console.log('marketplace guest ticket validation tests passed');
