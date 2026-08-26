const REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS = 2;
const REQUIRED_MARKETPLACE_SIGNATURE_DOCUMENTS = 2;
const SIGNING_TAB_COLLECTIONS = ['signHereTabs', 'initialHereTabs'];

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
  governanceSignerRole = null,
  ndaSignerRole = null,
}) => {
  const signerInput = (signerRole) => ({
    vendorName,
    vendorEmail,
    signerRole,
    clientUserId: String(vendorUserId),
    event,
    bid,
    application,
  });
  const compositeTemplate = (compositeTemplateId, templateId, signerRole) => ({
    compositeTemplateId,
    serverTemplates: [{ sequence: '1', templateId }],
    inlineTemplates: [
      {
        sequence: '2',
        recipients: { signers: [buildTemplateSigner(signerInput(signerRole))] },
      },
    ],
  });

  return {
    emailSubject: `Action Required: Sign Your Marketplace Agreement — ${event?.event_name || event?.event_id}`,
    compositeTemplates: [
      compositeTemplate(
        '1',
        docusign.governanceTemplateId,
        governanceSignerRole || docusign.signerRole
      ),
      compositeTemplate(
        '2',
        docusign.ndaTemplateId,
        ndaSignerRole || docusign.signerRole
      ),
    ],
    status: 'sent',
  };
};

const getSignerTabDocumentIds = (response = {}, clientUserId = null) => {
  const documentIds = new Set();
  for (const signer of response.signers || []) {
    if (
      clientUserId !== null &&
      String(signer?.clientUserId || '') !== String(clientUserId)
    ) {
      continue;
    }
    for (const collection of SIGNING_TAB_COLLECTIONS) {
      for (const tab of signer?.tabs?.[collection] || []) {
        const documentId = String(tab?.documentId || tab?.document_id || '').trim();
        if (documentId) documentIds.add(documentId);
      }
    }
  }
  return [...documentIds];
};

const getPendingEmbeddedVendorSigner = (response = {}, clientUserId = null) =>
  (response.signers || [])
    .filter((signer) =>
      signer?.recipientId &&
      String(signer?.status || '').toLowerCase() !== 'completed' &&
      (clientUserId === null ||
        String(signer?.clientUserId || '') === String(clientUserId))
    )
    .sort((left, right) =>
      Number(left.routingOrder || 0) - Number(right.routingOrder || 0) ||
      Number(left.recipientId || 0) - Number(right.recipientId || 0)
    )[0] || null;

const resolveTemplateSignerRole = (response = {}, preferredRole = null) => {
  const signers = response.signers || [];
  const preferred = signers.find(
    (signer) => String(signer?.roleName || '') === String(preferredRole || '')
  );
  const signer = preferred || (signers.length === 1 ? signers[0] : null);
  if (!signer?.roleName) {
    throw new Error('DocuSign template must contain exactly one resolvable vendor signer role.');
  }
  if (!getSignerTabDocumentIds({ signers: [signer] }).length) {
    throw new Error(`DocuSign template signer role ${signer.roleName} has no required signing tab.`);
  }
  return signer.roleName;
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

const inspectMarketplaceAgreementSignatures = (response, clientUserId = null) => {
  const signatureDocumentIds = getSignerTabDocumentIds(response, clientUserId);
  return {
    valid: signatureDocumentIds.length >= REQUIRED_MARKETPLACE_SIGNATURE_DOCUMENTS,
    signatureDocumentCount: signatureDocumentIds.length,
    signatureDocumentIds,
  };
};

module.exports = {
  REQUIRED_MARKETPLACE_AGREEMENT_DOCUMENTS,
  REQUIRED_MARKETPLACE_SIGNATURE_DOCUMENTS,
  buildVendorMarketplaceEnvelopeDefinition,
  getEnvelopeAgreementDocuments,
  getSignerTabDocumentIds,
  getPendingEmbeddedVendorSigner,
  inspectMarketplaceAgreementDocuments,
  inspectMarketplaceAgreementSignatures,
  resolveTemplateSignerRole,
};
