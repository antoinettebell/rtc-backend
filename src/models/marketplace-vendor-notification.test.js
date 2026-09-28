const assert = require('assert');
const MarketplaceVendorNotificationModel = require('./marketplace-vendor-notification');

const requiredFields = [
  'notification_id',
  'notification_key',
  'vendor_user_id',
  'event_id',
  'type',
  'title',
  'body',
  'action_required',
  'occurred_at',
];

requiredFields.forEach((field) => {
  assert.ok(
    MarketplaceVendorNotificationModel.schema.path(field),
    `Marketplace vendor notification must persist ${field}`
  );
});

assert.deepEqual(
  MarketplaceVendorNotificationModel.schema.path('type').enumValues,
  ['MARKETPLACE_EVENT_UPDATED', 'MARKETPLACE_AWARD_AMENDMENT']
);
assert.equal(
  MarketplaceVendorNotificationModel.schema.path('action_required').defaultValue,
  false
);

console.log('Marketplace vendor notification persistence tests passed.');
