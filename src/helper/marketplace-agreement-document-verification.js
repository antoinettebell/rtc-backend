const {
  REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS,
  inspectMarketplaceAgreementDocuments,
} = require('./docusign-vendor-envelope');

const verifyMarketplaceAgreementDocuments = async ({
  agreement,
  getEnvelopeDocuments,
  recordAudit = async () => {},
  attempts = 3,
  wait = async () => {},
}) => {
  let inspection = { valid: false, documentCount: 0, documents: [] };
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      inspection = inspectMarketplaceAgreementDocuments(
        await getEnvelopeDocuments(agreement.envelope_id)
      );
      lastError = null;
      if (inspection.valid) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await wait(attempt + 1);
  }

  if (lastError) throw lastError;

  if (inspection.valid) {
    agreement.required_document_count = inspection.documentCount;
    agreement.required_templates_verified_at = new Date();
    agreement.error_message = null;
    await agreement.save();
    await recordAudit('REQUIRED_TEMPLATES_VERIFIED', agreement.status, 'Both required agreement documents verified');
    return inspection;
  }

  agreement.status = 'ERROR';
  agreement.active_identity_key = null;
  agreement.required_document_count = inspection.documentCount;
  agreement.required_templates_verified_at = null;
  agreement.error_message = `DocuSign envelope contains ${inspection.documentCount} of ${REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS} required agreement documents.`;
  await agreement.save();
  await recordAudit('REQUIRED_TEMPLATES_MISSING', 'ERROR', agreement.error_message);
  return inspection;
};

module.exports = { verifyMarketplaceAgreementDocuments };
