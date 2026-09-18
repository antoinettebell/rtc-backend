#!/usr/bin/env node

/**
 * Development-only verification for the Tap to Pay interrupted-payment push.
 *
 * This creates an auditable $0.01 test attempt, injects a simulated DECLINED
 * CyberSource search result into the real reconciliation workflow, and sends
 * the real notification to the selected vendor. It never submits a payment.
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const {
  FoodTruckModel,
  OrderCounterModel,
  TapToPayPaymentAttemptModel,
  UserModel,
} = require('../src/models');
const {
  reconcileTapToPayAttempt,
} = require('../src/helper/tap-to-pay-interruption-helper');

const getArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const refuseUnsafeEnvironment = () => {
  const environmentNames = [
    process.env.NODE_ENV,
    process.env.APP_ENV,
    process.env.ENVIRONMENT,
  ].filter(Boolean);
  if (environmentNames.some((value) => /^(prod|production)$/i.test(value))) {
    throw new Error('This development simulation cannot run in production.');
  }
  if (!process.argv.includes('--confirm-development')) {
    throw new Error('Pass --confirm-development to confirm this is the dev server.');
  }
};

const run = async () => {
  refuseUnsafeEnvironment();

  const email = String(getArgument('--email') || '')
    .trim()
    .toLowerCase();
  if (!email) {
    throw new Error('Usage: node scripts/simulate-tap-to-pay-declined-push.js --email <vendor-email> --confirm-development');
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured.');

  await mongoose.connect(process.env.MONGO_URI);

  const vendor = await UserModel.findOne({ email, userType: 'VENDOR' })
    .select('_id email fcmTokens')
    .lean();
  if (!vendor) throw new Error(`No vendor account was found for ${email}.`);
  if (!vendor.fcmTokens?.some((entry) => entry?.token)) {
    throw new Error(`The vendor ${email} has no registered push-notification token.`);
  }

  const foodTruck = await FoodTruckModel.findOne({ userId: vendor._id })
    .select('_id name')
    .lean();
  if (!foodTruck) throw new Error(`No food truck was found for ${email}.`);

  const counter = await OrderCounterModel.findOneAndUpdate(
    { foodTruckId: foodTruck._id },
    { $inc: { sequenceValue: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const attempt = await TapToPayPaymentAttemptModel.create({
    food_truck_id: foodTruck._id,
    vendor_user_id: vendor._id,
    actor_type: 'VENDOR',
    checkout_key: `DEV-PUSH-SIM-${Date.now()}`,
    order_number: counter.sequenceValue,
    amount: 0.01,
    currency: 'USD',
    status: 'PROCESSING',
    started_at: new Date(),
    next_reconciliation_at: new Date(),
  });

  const simulatedTransactionId = `dev-simulated-decline-${Date.now()}`;
  const result = await reconcileTapToPayAttempt(attempt.toObject(), {
    searchTransactionsByReference: async (reference) => [
      {
        id: simulatedTransactionId,
        status: 'DECLINED',
        amount: 0.01,
        currency: 'USD',
        reference,
      },
    ],
  });

  if (result.status !== 'DECLINED') {
    throw new Error(`Unexpected reconciliation result: ${result.status}`);
  }

  console.log(
    `Development simulation completed for order #${attempt.order_number}. Check the vendor phone for the cancellation notification.`
  );
};

run()
  .catch((error) => {
    console.error(`Tap to Pay push simulation failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
