const assert = require('assert');
const {
  buildVendorMarketplaceEnvelopeDefinition,
  inspectMarketplaceAgreementDocuments,
} = require('./docusign-vendor-envelope');

const definition = buildVendorMarketplaceEnvelopeDefinition({
  docusign: {
    governanceTemplateId: 'governance-template',
    ndaTemplateId: 'nda-template',
    signerRole: 'VendorSigner',
  },
  vendorName: 'Jazzy Fried Rice',
  vendorEmail: 'jazzy@example.com',
  vendorUserId: 'vendor-1',
  event: { event_id: 'event-1', event_name: 'Test Event' },
  bid: { bid_id: 'bid-1' },
});

assert.deepEqual(
  definition.compositeTemplates.map((template) => ({
    id: template.compositeTemplateId,
    templateId: template.serverTemplates[0].templateId,
    serverSequence: template.serverTemplates[0].sequence,
    inlineSequence: template.inlineTemplates[0].sequence,
  })),
  [
    { id: 'governance', templateId: 'governance-template', serverSequence: '1', inlineSequence: '2' },
    { id: 'nda', templateId: 'nda-template', serverSequence: '1', inlineSequence: '2' },
  ],
  'each agreement document uses its own server-template then signer overlay sequence'
);
for (const template of definition.compositeTemplates) {
  const signer = template.inlineTemplates[0].recipients.signers[0];
  assert.equal(signer.roleName, 'VendorSigner');
  assert.equal(signer.clientUserId, 'vendor-1');
  assert.equal(signer.recipientId, '1');
  assert.equal(signer.routingOrder, '1');
}
assert.equal(definition.status, 'sent');

assert.deepEqual(
  inspectMarketplaceAgreementDocuments({
    envelopeDocuments: [
      { documentId: '1', name: 'Governance' },
      { documentId: '2', name: 'NDA' },
      { documentId: 'certificate', type: 'summary', name: 'Certificate' },
    ],
  }),
  {
    valid: true,
    documentCount: 2,
    documents: [
      { documentId: '1', name: 'Governance' },
      { documentId: '2', name: 'NDA' },
    ],
  }
);
assert.equal(
  inspectMarketplaceAgreementDocuments({
    envelopeDocuments: [{ documentId: '1', name: 'NDA' }],
  }).valid,
  false,
  'a one-template envelope cannot satisfy Marketplace agreement signing'
);

console.log('DocuSign vendor envelope tests passed');
