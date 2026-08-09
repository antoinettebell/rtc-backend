const assert = require('assert');
const {
  reconcileVendorAgreementEnvelope,
} = require('./marketplace-vendor-agreement-reconciliation');
const MarketplaceValidation = require('../v1/validations/marketplace-validation');

const run = async (envelopeStatus, completedDateTime = null) => {
  const calls = { saved: 0, submission: [], attachment: 0 };
  const agreement = {
    agreement_id: 'agreement-1',
    envelope_id: 'envelope-1',
    status: 'SENT',
    async save() { calls.saved += 1; },
  };
  const result = await reconcileVendorAgreementEnvelope({
    agreement,
    getEnvelopeStatus: async (id) => {
      assert.equal(id, 'envelope-1');
      return { status: envelopeStatus, completedDateTime };
    },
    mapEnvelopeStatus: (status) => ({
      completed: 'SIGNED',
      declined: 'DECLINED',
      voided: 'VOIDED',
      sent: 'SENT',
    })[status] || 'ERROR',
    setSubmissionSignatureStatus: async (_agreement, status) => {
      calls.submission.push(status);
    },
    persistSignedAgreementAttachment: async () => { calls.attachment += 1; },
    getAnnualAgreementExpiry: (signedAt) => new Date(signedAt.getTime() + 1000),
    now: () => new Date('2026-08-09T12:00:00.000Z'),
  });
  return { agreement, calls, result };
};

(async () => {
  const reconciliationRequest =
    MarketplaceValidation.startVendorAgreementSigning.body.validate({
      event_id: 'event-1',
      application_id: 'application-1',
      reconcile_only: true,
    });
  assert.equal(reconciliationRequest.error, undefined);
  assert.equal(reconciliationRequest.value.reconcile_only, true);

  const signed = await run('completed', '2026-08-09T11:00:00.000Z');
  assert.equal(signed.result.alreadySigned, true);
  assert.equal(signed.agreement.status, 'SIGNED');
  assert.equal(signed.calls.saved, 1);
  assert.deepEqual(signed.calls.submission, ['SIGNED']);
  assert.equal(signed.calls.attachment, 1);

  for (const [input, expected] of [
    ['sent', 'SENT'],
    ['declined', 'DECLINED'],
    ['voided', 'VOIDED'],
    ['unknown', 'ERROR'],
  ]) {
    const incomplete = await run(input);
    assert.equal(incomplete.result.alreadySigned, false);
    assert.equal(incomplete.agreement.status, expected);
    assert.equal(incomplete.calls.attachment, 0);
    assert.deepEqual(incomplete.calls.submission, [expected]);
  }

  assert.equal(
    await reconcileVendorAgreementEnvelope({ agreement: null }),
    null,
  );
  console.log('marketplace vendor agreement reconciliation tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
