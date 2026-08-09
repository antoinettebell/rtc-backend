const resolveMarketplaceTaxExemptionUpdate = (body = {}, existingEvent = null) => {
  const charitableEvent = body.charitable_event === true;
  const religiousOrganization = body.religious_organization === true;
  if (charitableEvent && religiousOrganization) {
    const error = new Error('Select either charitable event or religious organization, not both.');
    error.code = 400;
    throw error;
  }
  const exemptionSelected = charitableEvent || religiousOrganization;
  const selectedEntityCode = charitableEvent ? 'E' : religiousOrganization ? 'F' : null;
  const approvalPreserved = exemptionSelected &&
    existingEvent?.tax_exemption_status === 'APPROVED' &&
    existingEvent?.tax_exemption_entity_use_code === selectedEntityCode;
  return {
    charitable_event: charitableEvent,
    religious_organization: religiousOrganization,
    tax_exemption_status: exemptionSelected
      ? approvalPreserved ? 'APPROVED' : 'PENDING'
      : 'NOT_REQUESTED',
    tax_exemption_entity_use_code: approvalPreserved
      ? existingEvent.tax_exemption_entity_use_code
      : null,
    tax_exemption_certificate_url:
      existingEvent?.tax_exemption_certificate_url ||
      body.tax_exemption_certificate_url ||
      null,
  };
};

module.exports = { resolveMarketplaceTaxExemptionUpdate };
