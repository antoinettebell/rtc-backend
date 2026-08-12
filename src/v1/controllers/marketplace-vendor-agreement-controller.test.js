const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildSignedAgreementAttachmentContext,
  buildSignedAgreementAttachmentLink,
} = require('../../helper/marketplace-agreement-vendor-context');
const {
  reconcileVendorAgreementEnvelope,
} = require('../../helper/marketplace-vendor-agreement-reconciliation');

(async () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'marketplace-controller.js'),
    'utf8'
  );
  const start = source.slice(
    source.indexOf('exports.startVendorAgreementSigning'),
    source.indexOf('exports.vendorAgreementReturn')
  );
  assert.doesNotMatch(
    start,
    /foodTruck\._id/,
    'the complete signing/reuse/reconciliation controller path must tolerate a null food truck'
  );
  assert.match(start, /foodTruck\?\._id \|\| null/);
  assert.match(start, /buildSignedAgreementAttachmentContext/);
  assert.match(start, /active_identity_key: activeIdentityKey/);
  assert.match(start, /reserveActiveMarketplaceAgreement/);
  assert.match(start, /Concurrent signing request reused the active envelope/);
  assert.match(start, /for \(const candidate of existingAgreements \|\| \[\]\)/,
    'legacy duplicate agreements are all reconciled so a newer SENT envelope cannot hide a completed one');
  assert.match(
    start,
    /verifyVendorAgreementEnvelopeDocuments\(candidate\)[\s\S]*reconcileVendorAgreementEnvelope/,
    'existing envelopes must contain both required documents before reconciliation or reuse'
  );
  assert.match(
    start,
    /createVendorMarketplaceSigningEnvelope[\s\S]*verifyVendorAgreementEnvelopeDocuments\(agreement\)[\s\S]*createRecipientView/,
    'new envelopes must contain both required documents before the signing view opens'
  );
  const agreementModelSource = fs.readFileSync(
    path.join(__dirname, '../../models/marketplace-vendor-agreement.js'),
    'utf8'
  );
  assert.match(agreementModelSource, /partialFilterExpression: \{ active_identity_key: \{ \$type: 'string' \} \}/,
    'legacy agreements without an active identity are excluded from the unique partial index');
  assert.match(agreementModelSource, /required_document_count/);
  assert.match(agreementModelSource, /required_signature_document_count/);
  assert.match(agreementModelSource, /required_templates_verified_at/);

  const firstSigning = {
    vendor_user_id: 'vendor-1',
    event_vendor_profile_id: 'profile-1',
    food_truck_id: null,
    event_id: 'event-1',
    envelope_id: 'envelope-1',
  };
  assert.equal(firstSigning.food_truck_id, null);

  const agreement = {
    ...firstSigning,
    status: 'SENT',
    saveCount: 0,
    async save() { this.saveCount += 1; },
  };
  let attachmentPersistCount = 0;
  const reconciliation = await reconcileVendorAgreementEnvelope({
    agreement,
    getEnvelopeStatus: async () => ({ status: 'completed' }),
    mapEnvelopeStatus: () => 'SIGNED',
    setSubmissionSignatureStatus: async () => {},
    persistSignedAgreementAttachment: async (value) => {
      assert.equal(value.food_truck_id, null);
      attachmentPersistCount += 1;
    },
    getAnnualAgreementExpiry: () => new Date('2030-01-01T00:00:00.000Z'),
  });
  assert.equal(reconciliation.alreadySigned, true);
  assert.equal(attachmentPersistCount, 1);

  const reused = buildSignedAgreementAttachmentContext({
    agreement,
    eventId: agreement.event_id,
    vendorUserId: agreement.vendor_user_id,
    foodTruck: null,
    reuseExistingSignedDocument: true,
  });
  assert.equal(reused.food_truck_id, null);
  assert.equal(reused.reuse_existing_signed_document, true);

  const link = buildSignedAgreementAttachmentLink({
    eventId: agreement.event_id,
    vendorUserId: agreement.vendor_user_id,
    envelopeId: agreement.envelope_id,
    applicationId: 'application-1',
  });
  assert.deepEqual(link.update, { application_id: 'application-1' });

  const foodVendor = buildSignedAgreementAttachmentContext({
    agreement: { envelope_id: 'food-envelope' },
    eventId: 'event-2',
    vendorUserId: 'food-vendor',
    foodTruck: { _id: 'food-truck-1' },
  });
  assert.equal(foodVendor.food_truck_id, 'food-truck-1');
  console.log('marketplace vendor agreement controller execution tests passed');
})();
