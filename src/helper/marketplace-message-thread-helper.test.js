const assert = require('assert');
const {
  isMarketplaceMessageVisibleToVendor,
  isMarketplaceMessageInSubmission,
  getMarketplaceMessageUnreadState,
  buildMarketplaceMessageNotification,
} = require('./marketplace-message-thread-helper');

const conversation = { applicationId: 'application-1' };
const coordinatorMessage = {
  question_id: 'message-1', event_id: 'event-1', application_id: 'application-1',
  vendor_user_id: 'vendor-1', initiated_by_role: 'CUSTOMER', status: 'PUBLISHED',
  created_at: new Date('2026-08-10T01:00:00Z'), coordinator_read_at: new Date('2026-08-10T01:00:00Z'), vendor_read_at: null,
};
const vendorReply = {
  question_id: 'message-2', event_id: 'event-1', application_id: 'application-1',
  vendor_user_id: 'vendor-1', initiated_by_role: 'VENDOR', status: 'PENDING',
  created_at: new Date('2026-08-10T01:05:00Z'), coordinator_read_at: null, vendor_read_at: new Date('2026-08-10T01:05:00Z'),
};

for (const message of [coordinatorMessage, vendorReply]) {
  assert(isMarketplaceMessageInSubmission(message, conversation));
  assert(isMarketplaceMessageVisibleToVendor(message, 'vendor-1'));
  assert(!isMarketplaceMessageVisibleToVendor(message, 'vendor-2'));
}
assert(getMarketplaceMessageUnreadState(coordinatorMessage, { _id: 'vendor-1', userType: 'VENDOR' }));
coordinatorMessage.vendor_read_at = new Date('2026-08-10T01:01:00Z');
assert(!getMarketplaceMessageUnreadState(coordinatorMessage, { _id: 'vendor-1', userType: 'VENDOR' }));
assert(getMarketplaceMessageUnreadState(vendorReply, { _id: 'coordinator-1', userType: 'CUSTOMER' }));
vendorReply.coordinator_read_at = new Date('2026-08-10T01:06:00Z');
assert(!getMarketplaceMessageUnreadState(vendorReply, { _id: 'coordinator-1', userType: 'CUSTOMER' }));

const notification = buildMarketplaceMessageNotification(
  { ...coordinatorMessage, vendor_read_at: null, application_id: null, bid_id: 'bid-1' },
  { event_id: 'event-1', event_name: 'Food Festival', event_date: '2026-09-03' },
  { _id: 'vendor-1', userType: 'VENDOR' }
);
assert.strictEqual(notification.event_id, 'event-1');
assert.strictEqual(notification.bid_id, 'bid-1');
assert.strictEqual(notification.application_id, null);
assert.strictEqual(notification.unread, true);
assert.strictEqual(notification.event_name, 'Food Festival');

console.log('marketplace two-way thread tests passed');
