const {
  getEnvelopeAgreementDocuments,
  REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS,
} = require('./docusign-vendor-envelope');

const sanitizeAgreementFileName = (name, index) => {
  const baseName = String(name || `RTC Marketplace Agreement ${index + 1}`)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .trim();
  return /\.pdf$/i.test(baseName) ? baseName : `${baseName}.pdf`;
};

const getUniqueEnvelopeAgreementDocuments = (response = {}) => {
  const seenDocumentIds = new Set();
  return getEnvelopeAgreementDocuments(response).filter((document) => {
    const documentId = String(document?.documentId || document?.document_id || '').trim();
    if (!documentId || seenDocumentIds.has(documentId)) return false;
    seenDocumentIds.add(documentId);
    return true;
  }).slice(0, REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS);
};

const buildAgreementEmailAttachments = async ({
  envelopeId,
  envelopeDocuments,
  downloadEnvelopeDocument,
}) => {
  const documents = getUniqueEnvelopeAgreementDocuments(envelopeDocuments);
  if (documents.length !== REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS) {
    throw new Error(
      `DocuSign envelope does not contain exactly ${REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS} required agreement documents.`
    );
  }
  const attachments = [];
  for (const [index, document] of documents.entries()) {
    const documentId = String(document.documentId || document.document_id);
    const content = await downloadEnvelopeDocument(envelopeId, documentId);
    attachments.push({
      content: content.toString('base64'),
      filename: sanitizeAgreementFileName(document.name, index),
      type: 'application/pdf',
      disposition: 'attachment',
    });
  }
  return attachments;
};

const excludeAgreementDocuments = (attachments = []) =>
  attachments.filter((attachment) => attachment?.attachment_type !== 'AGREEMENT_DOCUMENT');

module.exports = {
  buildAgreementEmailAttachments,
  excludeAgreementDocuments,
  getUniqueEnvelopeAgreementDocuments,
};
