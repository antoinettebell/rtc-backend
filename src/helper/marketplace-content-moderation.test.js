const assert = require('assert');
const { moderateMarketplaceText } = require('./marketplace-content-moderation');

const blocked = [
  'Call me at (803) 555-1212',
  'eight zero three 555 1212',
  'vendor@example.com',
  'vendor at example dot com',
  'www.example.com',
  '@vendorhandle',
  '$cashhandle',
  'Find me on Instagram',
  'Send payment through Venmo',
  'Meet me at 123 Main Street',
];

for (const message of blocked) {
  assert.strictEqual(
    moderateMarketplaceText(message).status,
    'BLOCKED',
    `expected moderation to block: ${message}`
  );
}

for (const message of [
  'Can you provide two six-foot tables near the booth?',
  'The menu includes vegetarian and gluten-free options.',
  'Will electricity be available during setup?',
  'Booth 318 is beside booth 320.',
  'Event RTC-2026-8042 needs 4 tables and 12 chairs.',
  'The average price is $18.50 and the fee is $75.00.',
  'Setup is 08/10/2026 at 4:30 PM.',
  'Please provide 125 boxed meals for section 42.',
]) {
  assert.strictEqual(
    moderateMarketplaceText(message).status,
    'CLEAN',
    `expected ordinary marketplace message to pass: ${message}`
  );
}

console.log('marketplace content moderation tests passed');
