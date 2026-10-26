const assert = require('assert');
const { normalizeCobaltSos } = require('./vendor-compliance-provider-helper');

const legalBusiness = {
  legal_business_name: 'Sumpter Bell Enterprises LLC',
  business_registration_state: 'SC',
};

assert.strictEqual(normalizeCobaltSos({
  results: [{
    title: 'Sumpter Bell Enterprises L.L.C.',
    stateOfSosRegistration: 'South Carolina',
    status: 'Good Standing',
  }],
}, legalBusiness), 'PASSED');

assert.strictEqual(normalizeCobaltSos({
  results: [{
    title: 'Sumpter Bell Enterprises',
    stateOfSosRegistration: 'South Carolina',
    status: 'Good Standing',
  }],
}, legalBusiness), 'PASSED');

assert.strictEqual(normalizeCobaltSos({
  results: [{
    title: 'Sumpter Bell Enterprises L.L.C.',
    stateOfSosRegistration: 'South Carolina',
    status: 'Dissolved',
  }],
}, legalBusiness), 'FAILED');

console.log('Cobalt State legal-suffix normalization tests passed');
