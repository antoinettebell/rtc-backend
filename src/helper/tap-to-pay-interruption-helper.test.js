const assert = require('assert');

const mockModule = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { filename, loaded: true, exports };
};

const queryResult = (value) => ({
  select() {
    return this;
  },
  lean: async () => value,
});

let completedOrder = null;
let searchResults = [];
let sentNotification = null;
const updates = [];

const TapToPayPaymentAttemptModel = {
  updateOne: async (filter, update) => {
    updates.push({ filter, update });
    return { modifiedCount: 1 };
  },
  findOneAndUpdate: async (_filter, update) => ({
    _id: 'attempt-1',
    order_number: 321,
    vendor_user_id: 'vendor-1',
    actor_type: 'VENDOR',
    ...update.$set,
  }),
};

mockModule('../models', {
  OrderModel: {
    findOne: () => queryResult(completedOrder),
  },
  TapToPayPaymentAttemptModel,
  VendorEmployeeModel: {},
});
mockModule('./custom-notification', {
  sendNotificationToUsers: async (note) => {
    sentNotification = note;
  },
  sendNotificationToEmployees: async () => {},
});
mockModule('./cybersource-payment-helper', {
  APPROVED_STATUSES: new Set(['AUTHORIZED', 'SETTLED']),
  searchTransactionsByReference: async () => searchResults,
});

const {
  buildCanceledNotification,
  buildReviewNotification,
  reconcileTapToPayAttempt,
} = require('./tap-to-pay-interruption-helper');

const attempt = {
  _id: 'attempt-1',
  food_truck_id: 'truck-1',
  order_number: 321,
  reference: 'R1234567',
  vendor_user_id: 'vendor-1',
  actor_type: 'VENDOR',
};

(async () => {
  const canceled = buildCanceledNotification(attempt);
  assert.strictEqual(canceled.title, 'Tap to Pay Transaction Canceled');
  assert.match(canceled.body, /RDC canceled Tap to Pay for order #321/);
  assert.match(canceled.body, /no payment was approved/);
  assert.match(
    canceled.body,
    /allow two minutes before charging the card again/
  );
  assert.strictEqual(
    canceled.data.activityType,
    'TAP_TO_PAY_TRANSACTION_CANCELED'
  );

  const review = buildReviewNotification(attempt);
  assert.strictEqual(review.title, 'Tap to Pay Payment Needs Review');
  assert.match(review.body, /Do not charge the customer again/);
  assert.doesNotMatch(canceled.body, /transaction id|card number|account number/i);

  searchResults = [];
  sentNotification = null;
  const noProviderResult = await reconcileTapToPayAttempt(attempt);
  assert.strictEqual(noProviderResult.status, 'RETRY');
  assert.strictEqual(sentNotification, null);

  searchResults = [{ id: 'txn-declined', status: 'DECLINED' }];
  sentNotification = null;
  const declined = await reconcileTapToPayAttempt(attempt);
  assert.strictEqual(declined.status, 'DECLINED');
  assert.strictEqual(
    sentNotification['vendor-1'].title,
    'Tap to Pay Transaction Canceled'
  );

  searchResults = [{ id: 'txn-1', status: 'AUTHORIZED' }];
  sentNotification = null;
  const reviewRequired = await reconcileTapToPayAttempt(attempt);
  assert.strictEqual(reviewRequired.status, 'REVIEW_REQUIRED');
  assert.strictEqual(
    sentNotification['vendor-1'].title,
    'Tap to Pay Payment Needs Review'
  );

  completedOrder = { _id: 'order-1', transactionId: 'txn-completed' };
  sentNotification = null;
  const completed = await reconcileTapToPayAttempt(attempt);
  assert.strictEqual(completed.status, 'COMPLETED');
  assert.strictEqual(sentNotification, null);
  assert(updates.length >= 3);

  console.log('Tap to Pay interruption helper tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
