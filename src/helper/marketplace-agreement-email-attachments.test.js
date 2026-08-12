const assert = require('assert');
const {
  buildAgreementEmailAttachments,
  excludeAgreementDocuments,
  getUniqueEnvelopeAgreementDocuments,
} = require('./marketplace-agreement-email-attachments');

const envelopeDocuments = {
  envelopeDocuments: [
    { documentId: '1', name: 'Governance Agreement' },
    { documentId: '2', name: 'NDA.pdf' },
    { documentId: '2', name: 'NDA duplicate' },
    { documentId: '3', name: 'Unexpected extra document' },
    { documentId: 'certificate', name: 'Certificate of Completion' },
  ],
};

assert.deepStrictEqual(
  getUniqueEnvelopeAgreementDocuments(envelopeDocuments).map((document) => document.documentId),
  ['1', '2']
);
assert.deepStrictEqual(
  excludeAgreementDocuments([
    { attachment_type: 'APPLICATION_MENU_PDF' },
    { attachment_type: 'AGREEMENT_DOCUMENT' },
  ]).map((attachment) => attachment.attachment_type),
  ['APPLICATION_MENU_PDF']
);

(async () => {
  const downloads = [];
  const attachments = await buildAgreementEmailAttachments({
    envelopeId: 'envelope-1',
    envelopeDocuments,
    downloadEnvelopeDocument: async (envelopeId, documentId) => {
      downloads.push([envelopeId, documentId]);
      return Buffer.from(`signed-${documentId}`);
    },
  });
  assert.deepStrictEqual(downloads, [
    ['envelope-1', '1'],
    ['envelope-1', '2'],
  ]);
  assert.deepStrictEqual(attachments.map((attachment) => attachment.filename), [
    'Governance Agreement.pdf',
    'NDA.pdf',
  ]);
  assert.strictEqual(attachments.length, 2);
  await assert.rejects(
    () => buildAgreementEmailAttachments({
      envelopeId: 'envelope-incomplete',
      envelopeDocuments: { envelopeDocuments: [{ documentId: '1', name: 'NDA' }] },
      downloadEnvelopeDocument: async () => Buffer.from('signed'),
    }),
    /exactly 2 required agreement documents/
  );
  console.log('marketplace agreement email attachment tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
