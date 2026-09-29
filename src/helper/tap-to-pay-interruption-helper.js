const {
  OrderModel,
  TapToPayPaymentAttemptModel,
  VendorEmployeeModel,
} = require('../models');
const CustomNotification = require('./custom-notification');
const CyberSourcePaymentHelper = require('./cybersource-payment-helper');

const APPROVED_STATUSES = CyberSourcePaymentHelper.APPROVED_STATUSES;
const NOT_APPROVED_STATUSES = new Set([
  'CANCELED',
  'CANCELLED',
  'DECLINED',
  'FAILED',
  'INVALID_REQUEST',
  'REJECTED',
  'REVERSED',
  'SERVER_ERROR',
  'VOIDED',
]);
const BASE_RECONCILIATION_DELAY_MS = 15 * 1000;
const MAX_RECONCILIATION_DELAY_MS = 5 * 60 * 1000;

const buildCanceledNotification = (attempt) => ({
  title: 'Tap to Pay Transaction Canceled',
  body:
    `RDC canceled Tap to Pay for order #${attempt.order_number} because the transaction did not finish and no payment was approved. ` +
    'Ask the customer to approve the transaction and present payment again when ready. ' +
    'To prevent potential fraud rejection, please allow two minutes before charging the card again.',
  data: {
    activityType: 'TAP_TO_PAY_TRANSACTION_CANCELED',
    orderNumber: String(attempt.order_number),
    attemptId: String(attempt._id),
  },
});

const buildReviewNotification = (attempt) => ({
  title: 'Tap to Pay Payment Needs Review',
  body:
    `Order #${attempt.order_number} may have been approved, but RDC could not finish the order. ` +
    'Do not charge the customer again. Contact support.',
  data: {
    activityType: 'TAP_TO_PAY_PAYMENT_REVIEW_REQUIRED',
    orderNumber: String(attempt.order_number),
    attemptId: String(attempt._id),
  },
});

const sendAttemptNotification = async (attempt, note) => {
  if (attempt.actor_type === 'EMPLOYEE' && attempt.employee_internal_id) {
    const employee = await VendorEmployeeModel.findOne({
      employee_internal_id: attempt.employee_internal_id,
    })
      .select('_id employee_internal_id fcmTokens')
      .lean();
    if (employee) {
      await CustomNotification.sendNotificationToEmployees([employee], note);
      return;
    }
  }

  await CustomNotification.sendNotificationToUsers({
    [String(attempt.vendor_user_id)]: note,
  });
};

const scheduleReconciliationRetry = async (attempt, now) => {
  const attempts = Number(attempt.reconciliation_attempts || 0) + 1;
  const delay = Math.min(
    BASE_RECONCILIATION_DELAY_MS * 2 ** Math.min(attempts, 5),
    MAX_RECONCILIATION_DELAY_MS
  );
  await TapToPayPaymentAttemptModel.updateOne(
    {
      _id: attempt._id,
      status: { $in: ['PROCESSING', 'FINALIZING'] },
    },
    {
      $set: {
        last_reconciliation_at: now,
        next_reconciliation_at: new Date(now.getTime() + delay),
      },
      $inc: { reconciliation_attempts: 1 },
    }
  );
};

const reconcileTapToPayAttempt = async (
  attempt,
  {
    now = new Date(),
    searchTransactionsByReference =
      CyberSourcePaymentHelper.searchTransactionsByReference,
  } = {}
) => {
  const completedOrder = await OrderModel.findOne({
    foodTruckId: attempt.food_truck_id,
    orderNumber: attempt.order_number,
    paymentMethod: 'TAP_TO_PAY',
    paymentStatus: 'PAID',
    deletedAt: null,
  })
    .select('_id transactionId')
    .lean();
  if (completedOrder) {
    await TapToPayPaymentAttemptModel.updateOne(
      {
        _id: attempt._id,
        status: { $in: ['PROCESSING', 'FINALIZING'] },
      },
      {
        $set: {
          status: 'COMPLETED',
          completed_at: now,
          next_reconciliation_at: null,
          transaction_id: completedOrder.transactionId || null,
        },
      }
    );
    return { status: 'COMPLETED' };
  }

  let transactions;
  try {
    transactions = await searchTransactionsByReference(attempt.reference);
  } catch (error) {
    await scheduleReconciliationRetry(attempt, now);
    await TapToPayPaymentAttemptModel.updateOne(
      { _id: attempt._id },
      { $set: { last_reconciliation_error_at: now } }
    );
    console.error('Tap to Pay transaction reconciliation failed', {
      attemptId: String(attempt._id),
      orderNumber: attempt.order_number,
      code: error?.code,
    });
    return { status: 'RETRY' };
  }

  const approvedTransaction = transactions.find((transaction) =>
    APPROVED_STATUSES.has(transaction.status)
  );
  const declinedTransaction = transactions.find((transaction) =>
    NOT_APPROVED_STATUSES.has(transaction.status)
  );
  if (!approvedTransaction && !declinedTransaction) {
    await scheduleReconciliationRetry(attempt, now);
    return { status: 'RETRY' };
  }

  const nextStatus = approvedTransaction ? 'REVIEW_REQUIRED' : 'DECLINED';
  const updated = await TapToPayPaymentAttemptModel.findOneAndUpdate(
    {
      _id: attempt._id,
      status: { $in: ['PROCESSING', 'FINALIZING'] },
    },
    {
      $set: {
        status: nextStatus,
        declined_at: declinedTransaction ? now : null,
        next_reconciliation_at: null,
        transaction_id: approvedTransaction?.id || declinedTransaction?.id || null,
      },
    },
    { new: true }
  );
  if (!updated) return { status: 'ALREADY_RESOLVED' };

  const note = approvedTransaction
    ? buildReviewNotification(updated)
    : buildCanceledNotification(updated);
  await sendAttemptNotification(updated, note);
  await TapToPayPaymentAttemptModel.updateOne(
    { _id: updated._id, notification_sent_at: null },
    { $set: { notification_sent_at: new Date() } }
  );
  return { status: nextStatus };
};

const processPendingTapToPayAttempts = async ({ now = new Date() } = {}) => {
  const attempts = await TapToPayPaymentAttemptModel.find({
    status: { $in: ['PROCESSING', 'FINALIZING'] },
    next_reconciliation_at: { $ne: null, $lte: now },
  })
    .sort({ next_reconciliation_at: 1 })
    .limit(50)
    .lean();

  const results = [];
  for (const attempt of attempts) {
    results.push(await reconcileTapToPayAttempt(attempt, { now }));
  }
  return results;
};

module.exports = {
  buildCanceledNotification,
  buildReviewNotification,
  processPendingTapToPayAttempts,
  reconcileTapToPayAttempt,
};
