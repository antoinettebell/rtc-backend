const assert = require('assert');
const { refundPaidMarketplaceVendorFee } = require('./marketplace-vendor-fee-refund');

const payment = {
  payment_id: 'payment-1', payment_status: 'PAID',
  processor_transaction_id: 'transaction-1', total_amount: 25.75,
};
const makeHarness = (processResult) => {
  const calls = { claim: 0, process: 0, complete: 0, fail: 0 };
  return {
    calls,
    dependencies: {
      claimRefund: async () => { calls.claim += 1; return payment; },
      processRefund: async (input) => { calls.process += 1; calls.processInput = input; return processResult; },
      completeRefund: async (input) => { calls.complete += 1; calls.completeInput = input; return { ...payment, payment_status: 'REFUNDED' }; },
      failRefund: async (input) => { calls.fail += 1; calls.failInput = input; },
    },
  };
};

(async () => {
  {
    const harness = makeHarness({ success: true, refundTransactionId: 'refund-1', mode: 'void' });
    const result = await refundPaidMarketplaceVendorFee({ payment, actorUserId: 'customer-1', ...harness.dependencies });
    assert.equal(result.refunded, true);
    assert.deepStrictEqual(harness.calls.processInput, { transactionId: 'transaction-1', amount: 25.75 });
    assert.equal(harness.calls.completeInput.refundTransactionId, 'refund-1');
    assert.equal(harness.calls.fail, 0);
  }
  {
    const harness = makeHarness({ success: false, message: 'Gateway declined refund' });
    await assert.rejects(
      () => refundPaidMarketplaceVendorFee({ payment, actorUserId: 'customer-1', ...harness.dependencies }),
      /Gateway declined refund/
    );
    assert.equal(harness.calls.complete, 0);
    assert.equal(harness.calls.fail, 1);
  }
  {
    const harness = makeHarness({ success: true });
    const result = await refundPaidMarketplaceVendorFee({
      payment: { payment_status: 'PENDING' }, actorUserId: 'customer-1', ...harness.dependencies,
    });
    assert.equal(result.refunded, false);
    assert.equal(harness.calls.process, 0);
  }
  console.log('marketplace vendor fee refund tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
