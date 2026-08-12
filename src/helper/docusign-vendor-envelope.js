const REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS = 2;

const buildTemplateSigner = ({
  vendorName,
  vendorEmail,
  signerRole,
  clientUserId,
  event,
  bid,
  application,
}) => ({
  email: vendorEmail,
  name: vendorName,
  roleName: signerRole,
  recipientId: '1',
  routingOrder: '1',
  clientUserId,
  tabs: {
    textTabs: [
      { tabLabel: 'EventName', value: event?.event_name || '' },
      { tabLabel: 'EventId', value: event?.event_id || '' },
      {
        tabLabel: 'SubmissionId',
        value: bid?.bid_id || application?.application_id || '',
      },
    ],
  },
});

const buildVendorMarketplaceEnvelopeDefinition = ({
  docusign,
  vendorName,
  vendorEmail,
  vendorUserId,
  event,
  bid = null,
  application = null,
}) => {
  const signerInput = {
    vendorName,
    vendorEmail,
    signerRole: docusign.signerRole,
    clientUserId: String(vendorUserId),
    event,
    bid,
    application,
  };
  const compositeTemplate = (compositeTemplateId, templateId) => ({
    compositeTemplateId,
    serverTemplates: [{ sequence: '1', templateId }],
    inlineTemplates: [
      {
        sequence: '2',
        recipients: { signers: [buildTemplateSigner(signerInput)] },
      },
    ],
  });

  return {
    emailSubject: `RTC Event Marketplace Agreements - ${event?.event_name || event?.event_id}`,
    compositeTemplates: [
      compositeTemplate('governance', docusign.governanceTemplateId),
      compositeTemplate('nda', docusign.ndaTemplateId),
    ],
    status: 'sent',
  };
};

const getEnvelopeAgreementDocuments = (response = {}) =>
  (response.envelopeDocuments || response.documents || []).filter((document) => {
    const documentId = String(document?.documentId || document?.document_id || '').toLowerCase();
    const documentType = String(document?.type || '').toLowerCase();
    return documentId !== 'certificate' && documentType !== 'summary';
  });

const inspectMarketplaceAgreementDocuments = (response) => {
  const documents = getEnvelopeAgreementDocuments(response);
  return {
    valid: documents.length >= REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS,
    documentCount: documents.length,
    documents,
  };
};

module.exports = {
  REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS,
  buildVendorMarketplaceEnvelopeDefinition,
  getEnvelopeAgreementDocuments,
  inspectMarketplaceAgreementDocuments,
};
