const assert = require('node:assert/strict');
const {
  buildIntegrationAlertEmail,
} = require('./integration-alert-email-helper');

const body = buildIntegrationAlertEmail({
  subject: 'DocuSign signed document email fetch error',
  error: {
    code: 'DOCUSIGN_404',
    message: 'The envelope specified either does not exist or you have no rights to it.',
  },
  occurredAt: new Date('2026-09-28T12:00:00.000Z'),
});

assert.match(body, /external integration request did not complete/i);
assert.match(body, /DOCUSIGN_404/);
assert.match(body, /2026-09-28T12:00:00\.000Z/);
assert.doesNotMatch(body, /envelope specified/i);
assert.doesNotMatch(body, /agreement_id|envelope_id/i);

const escaped = buildIntegrationAlertEmail({
  subject: '<script>alert(1)</script>',
  error: { status: 502 },
  occurredAt: new Date('2026-09-28T12:00:00.000Z'),
});
assert.doesNotMatch(escaped, /<script>/);
assert.match(escaped, /&lt;script&gt;/);

console.log('Integration alert email safety tests passed');
