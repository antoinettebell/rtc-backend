const reconcileVendorAgreementEnvelope = async ({
  agreement,
  getEnvelopeStatus,
  mapEnvelopeStatus,
  setSubmissionSignatureStatus,
  persistSignedAgreementAttachment,
  getAnnualAgreementExpiry,
  now = () => new Date(),
}) => {
  if (!agreement?.envelope_id) return null;
  const envelope = await getEnvelopeStatus(agreement.envelope_id);
  const status = mapEnvelopeStatus(envelope.status);
  agreement.status = status;
  if (status === 'SIGNED') {
    agreement.signed_at = envelope.completedDateTime
      ? new Date(envelope.completedDateTime)
      : now();
    agreement.expires_at = getAnnualAgreementExpiry(agreement.signed_at);
  }
  await agreement.save();
  await setSubmissionSignatureStatus(agreement, status);
  if (status === 'SIGNED') {
    await persistSignedAgreementAttachment(agreement);
  }
  return { agreement, status, alreadySigned: status === 'SIGNED' };
};

module.exports = { reconcileVendorAgreementEnvelope };
