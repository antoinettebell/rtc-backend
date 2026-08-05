const assert = require('assert');
const {
  buildEventVendorAwardDetailsHtml,
  buildFoodVendorAwardDetailsHtml,
} = require('./marketplace-award-email-helper');

const assertIncludes = (html, values) => {
  values.forEach((value) => assert(html.includes(value), `Expected email HTML to include: ${value}`));
};

const bidHtml = buildFoodVendorAwardDetailsHtml({
  bid: {
    full_bid_amount: 1250,
    price_per_guest: 18,
    average_price_per_meal: 16,
    menu_description: 'Pizza and salads',
    notes: 'Includes serving staff',
    insurance_confirmed: true,
    permits_confirmed: true,
    liquor_license_confirmed: false,
  },
  vendor: { email: 'pizza@example.com', countryCode: '+1', mobileNumber: '5551234567' },
});
assertIncludes(bidHtml, [
  'Food Vendor',
  'pizza@example.com',
  '+15551234567',
  '$1250.00',
  'Pizza and salads',
  'Includes serving staff',
  'Electricity required',
  'Electricity fee',
]);

const applicationHtml = buildFoodVendorAwardDetailsHtml({
  application: {
    business_name: 'Pizza House',
    contact_name: 'Pat Vendor',
    phone: '555-111-2222',
    email: 'pat@example.com',
    food_type_cuisine: 'Pizza',
    menu_description: 'Wood-fired pizza',
    notes: 'Vegetarian options',
  },
  event: { vendor_fee: 275 },
});
assertIncludes(applicationHtml, [
  '$275.00',
  'Pizza House',
  'Pat Vendor',
  '555-111-2222',
  'pat@example.com',
  'Wood-fired pizza',
]);

const eventVendorHtml = buildEventVendorAwardDetailsHtml({
  application: {
    vendor_types: ['MERCHANDISE', 'SERVICE'],
    business_name: 'Maker Shop',
    contact_name: 'Morgan Maker',
    contact_number: '555-333-4444',
    category_fee: 100,
    electricity_required: true,
    electricity_fee: 25,
    checkout_subtotal: 125,
    offering_bullets: ['Shirts', 'Custom printing'],
    average_price: 30,
    additional_notes: 'Needs one table',
  },
  vendor: { email: 'maker@example.com' },
});
assertIncludes(eventVendorHtml, [
  'MERCHANDISE, SERVICE',
  'maker@example.com',
  '555-333-4444',
  '$100.00',
  '$25.00',
  '$125.00',
  'Shirts, Custom printing',
  'Needs one table',
]);

console.log('marketplace award email helper tests passed');
