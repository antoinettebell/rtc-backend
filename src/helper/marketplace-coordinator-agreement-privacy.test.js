const assert = require('assert');
const {
  hideMarketplaceAgreementFromCoordinator,
} = require('./marketplace-coordinator-agreement-privacy');

const source = {
  application_id: 'application-1',
  offering_bullets: ['Handmade goods'],
  attachments: [{ attachment_type: 'AGREEMENT_DOCUMENT', file_url: 'signed.pdf' }],
  agreement_document_url: 'signed.pdf',
  agreement_document_key: 'signed-key',
  agreement_provider: 'DOCUSIGN',
  agreement_status: 'SIGNED',
  nda_version: 'nda-v1',
  nda_accepted_at: new Date(),
  governance_version: 'governance-v1',
  governance_accepted_at: new Date(),
};
const result = hideMarketplaceAgreementFromCoordinator(source);
assert.equal(result.application_id, 'application-1');
assert.deepStrictEqual(result.offering_bullets, ['Handmade goods']);
for (const field of [
  'attachments',
  'agreement_document_url',
  'agreement_document_key',
  'agreement_provider',
  'agreement_status',
  'nda_version',
  'nda_accepted_at',
  'governance_version',
  'governance_accepted_at',
]) {
  assert.equal(Object.prototype.hasOwnProperty.call(result, field), false, field);
}
assert.ok(source.attachments, 'source record must not be mutated');
console.log('marketplace coordinator agreement privacy tests passed');
