const assert = require('assert');
const {
  verifyMarketplaceAgreementDocuments,
} = require('./marketplace-agreement-document-verification');

const makeAgreement = () => ({
  envelope_id: 'envelope-1',
  status: 'SENT',
  active_identity_key: 'active-1',
  saveCount: 0,
  async save() { this.saveCount += 1; },
});

(async () => {
  {
    const agreement = makeAgreement();
    const audits = [];
    const result = await verifyMarketplaceAgreementDocuments({
      agreement,
      getEnvelopeDocuments: async () => ({
        envelopeDocuments: [
          { documentId: '1', name: 'Governance' },
          { documentId: '2', name: 'NDA' },
        ],
      }),
      recordAudit: async (...args) => audits.push(args),
    });
    assert.equal(result.valid, true);
    assert.equal(agreement.status, 'SENT');
    assert.equal(agreement.required_document_count, 2);
    assert(agreement.required_templates_verified_at instanceof Date);
    assert.equal(agreement.active_identity_key, 'active-1');
    assert.equal(agreement.saveCount, 1);
    assert.equal(audits[0][0], 'REQUIRED_TEMPLATES_VERIFIED');
  }

  {
    const agreement = makeAgreement();
    const audits = [];
    const result = await verifyMarketplaceAgreementDocuments({
      agreement,
      getEnvelopeDocuments: async () => ({
        envelopeDocuments: [{ documentId: '1', name: 'NDA' }],
      }),
      recordAudit: async (...args) => audits.push(args),
    });
    assert.equal(result.valid, false);
    assert.equal(agreement.status, 'ERROR');
    assert.equal(agreement.active_identity_key, null);
    assert.equal(agreement.required_document_count, 1);
    assert.equal(agreement.required_templates_verified_at, null);
    assert.match(agreement.error_message, /1 of 2 required agreement documents/);
    assert.equal(agreement.saveCount, 1);
    assert.equal(audits[0][0], 'REQUIRED_TEMPLATES_MISSING');
  }

  {
    const agreement = makeAgreement();
    let calls = 0;
    const result = await verifyMarketplaceAgreementDocuments({
      agreement,
      getEnvelopeDocuments: async () => {
        calls += 1;
        return {
          envelopeDocuments: calls === 1
            ? [{ documentId: '1', name: 'NDA' }]
            : [
                { documentId: '1', name: 'Governance' },
                { documentId: '2', name: 'NDA' },
              ],
        };
      },
    });
    assert.equal(result.valid, true);
    assert.equal(calls, 2, 'temporary DocuSign document propagation is retried');
  }

  console.log('Marketplace agreement document verification tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
