const reconcileVendorAgreementEnvelope = async ({
  agreement,
  getEnvelopeStatus,
  mapEnvelopeStatus,
  setSubmissionSignatureStatus,
  persistSignedAgreementAttachment,
  getAnnualAgreementExpiry,
  recordAudit = async () => {},
  now = () => new Date(),
}) => {
  if (!agreement?.envelope_id) return null;
  await recordAudit('RECONCILIATION_ATTEMPT', agreement.status);
  let envelope;
  try {
    envelope = await getEnvelopeStatus(agreement.envelope_id);
  } catch (error) {
    await recordAudit(
      'RETRY_SCHEDULED',
      agreement.status,
      'DocuSign status lookup will be retried'
    );
    throw error;
  }
  const status = mapEnvelopeStatus(envelope.status);
  await recordAudit('STATUS_REFRESHED', status, `DocuSign status: ${String(envelope.status || 'unknown')}`);
  agreement.status = status;
  agreement.error_message = null;
  if (status === 'SIGNED') {
    agreement.return_status = agreement.return_status || 'completed';
    agreement.signed_at = envelope.completedDateTime
      ? new Date(envelope.completedDateTime)
      : now();
    agreement.expires_at = getAnnualAgreementExpiry(agreement.signed_at);
  }
  if (['SIGNED', 'CANCELLED', 'DECLINED', 'VOIDED', 'ERROR'].includes(status)) {
    agreement.active_identity_key = null;
  }
  await agreement.save();
  await setSubmissionSignatureStatus(agreement, status);
  if (status === 'SIGNED') {
    await persistSignedAgreementAttachment(agreement);
    await recordAudit('SIGNED_DOCUMENT_RETRIEVED', status);
  }
  return { agreement, status, alreadySigned: status === 'SIGNED' };
};

module.exports = { reconcileVendorAgreementEnvelope };
