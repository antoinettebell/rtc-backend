const assert = require('assert');
const { resolveMarketplaceTaxExemptionUpdate } = require('./marketplace-tax-exemption-helper');

const approvedCharitable = {
  charitable_event: true,
  religious_organization: false,
  tax_exemption_status: 'APPROVED',
  tax_exemption_entity_use_code: 'E',
  tax_exemption_certificate_url: 'https://files/certificate.pdf',
};
const approvedReligious = {
  charitable_event: false,
  religious_organization: true,
  tax_exemption_status: 'APPROVED',
  tax_exemption_entity_use_code: 'F',
  tax_exemption_certificate_url: 'https://files/religious-certificate.pdf',
};

assert.deepEqual(
  resolveMarketplaceTaxExemptionUpdate(approvedCharitable, approvedCharitable),
  approvedCharitable
);
assert.deepEqual(resolveMarketplaceTaxExemptionUpdate({
  ...approvedCharitable,
  event_description: 'Unrelated edit',
}, approvedCharitable), approvedCharitable);
assert.deepEqual(
  resolveMarketplaceTaxExemptionUpdate(approvedReligious, approvedReligious),
  approvedReligious
);

assert.deepEqual(resolveMarketplaceTaxExemptionUpdate({
  charitable_event: false,
  religious_organization: true,
}, approvedCharitable), {
  charitable_event: false,
  religious_organization: true,
  tax_exemption_status: 'PENDING',
  tax_exemption_entity_use_code: null,
  tax_exemption_certificate_url: approvedCharitable.tax_exemption_certificate_url,
});
assert.deepEqual(resolveMarketplaceTaxExemptionUpdate({
  charitable_event: true,
  religious_organization: false,
}, approvedReligious), {
  charitable_event: true,
  religious_organization: false,
  tax_exemption_status: 'PENDING',
  tax_exemption_entity_use_code: null,
  tax_exemption_certificate_url: approvedReligious.tax_exemption_certificate_url,
});
assert.deepEqual(resolveMarketplaceTaxExemptionUpdate({
  charitable_event: false,
  religious_organization: false,
}, approvedCharitable), {
  charitable_event: false,
  religious_organization: false,
  tax_exemption_status: 'NOT_REQUESTED',
  tax_exemption_entity_use_code: null,
  tax_exemption_certificate_url: approvedCharitable.tax_exemption_certificate_url,
});
assert.deepEqual(resolveMarketplaceTaxExemptionUpdate({
  charitable_event: false,
  religious_organization: false,
}, approvedReligious), {
  charitable_event: false,
  religious_organization: false,
  tax_exemption_status: 'NOT_REQUESTED',
  tax_exemption_entity_use_code: null,
  tax_exemption_certificate_url: approvedReligious.tax_exemption_certificate_url,
});
assert.deepEqual(resolveMarketplaceTaxExemptionUpdate({
  charitable_event: false,
  religious_organization: true,
}, approvedReligious), {
  charitable_event: false,
  religious_organization: true,
  tax_exemption_status: 'APPROVED',
  tax_exemption_entity_use_code: 'F',
  tax_exemption_certificate_url: approvedReligious.tax_exemption_certificate_url,
});
assert.deepEqual(resolveMarketplaceTaxExemptionUpdate({}, null), {
  charitable_event: false,
  religious_organization: false,
  tax_exemption_status: 'NOT_REQUESTED',
  tax_exemption_entity_use_code: null,
  tax_exemption_certificate_url: null,
});
assert.throws(() => resolveMarketplaceTaxExemptionUpdate({
  charitable_event: true,
  religious_organization: true,
}), /either charitable event or religious organization/);
console.log('Marketplace tax-exemption preservation tests passed.');
