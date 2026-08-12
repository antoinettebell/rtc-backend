const buildRefundError = (message, code = 409) => Object.assign(new Error(message), { code });

const refundPaidMarketplaceVendorFee = async ({
  payment,
  actorUserId,
  claimRefund,
  processRefund,
  completeRefund,
  failRefund,
}) => {
  if (!payment || String(payment.payment_status || '').toUpperCase() !== 'PAID') {
    return { refunded: false, payment };
  }
  if (!payment.processor_transaction_id) {
    throw buildRefundError(
      'This paid vendor fee has no processor transaction available for an automatic refund.'
    );
  }
  const amount = Number(payment.total_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw buildRefundError('This paid vendor fee has no refundable processor amount.');
  }

  const claimedPayment = await claimRefund({
    paymentId: payment.payment_id,
    actorUserId,
  });
  if (!claimedPayment) {
    throw buildRefundError('This vendor fee refund is already processing or has been completed.');
  }

  let refund;
  try {
    refund = await processRefund({
      transactionId: payment.processor_transaction_id,
      amount,
    });
  } catch (error) {
    await failRefund({
      paymentId: payment.payment_id,
      actorUserId,
      message: error?.message || 'Processor refund failed',
    });
    throw buildRefundError(error?.message || 'The vendor fee refund failed.', 502);
  }
  if (!refund?.success) {
    await failRefund({
      paymentId: payment.payment_id,
      actorUserId,
      message: refund?.message || 'Processor refund failed',
    });
    throw buildRefundError(refund?.message || 'The vendor fee refund failed.', 502);
  }

  const refundedPayment = await completeRefund({
    paymentId: payment.payment_id,
    actorUserId,
    refundTransactionId: refund.refundTransactionId || refund?.fullResponse?.transId || null,
    refundMode: refund.mode || 'refund',
  });
  if (!refundedPayment) {
    throw buildRefundError(
      'The processor refund succeeded, but its Marketplace payment record requires administrator review.',
      500
    );
  }
  return { refunded: true, payment: refundedPayment, refund };
};

module.exports = { refundPaidMarketplaceVendorFee };
