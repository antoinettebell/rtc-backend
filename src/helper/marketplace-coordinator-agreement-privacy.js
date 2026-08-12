const hideMarketplaceAgreementFromCoordinator = (record = {}) => {
  const safeRecord = { ...record };
  delete safeRecord.attachments;
  delete safeRecord.agreement_document_url;
  delete safeRecord.agreement_document_key;
  delete safeRecord.signed_document_url;
  delete safeRecord.signed_document_key;
  delete safeRecord.agreement_provider;
  delete safeRecord.agreement_status;
  delete safeRecord.nda_version;
  delete safeRecord.nda_accepted_at;
  delete safeRecord.governance_version;
  delete safeRecord.governance_accepted_at;
  return safeRecord;
};

module.exports = { hideMarketplaceAgreementFromCoordinator };
