const assert = require('assert');
const {
  TOKEN_BYTES,
  hashTicketToken,
  createTicketToken,
  buildPublicTicketUrl,
} = require('./ticket-token-helper');

const first = createTicketToken();
const second = createTicketToken();
assert.strictEqual(Buffer.from(first.token, 'base64url').length, TOKEN_BYTES);
assert.strictEqual(first.tokenHash, hashTicketToken(first.token));
assert.notStrictEqual(first.token, second.token);
assert.notStrictEqual(first.tokenHash, second.tokenHash);
assert.strictEqual(
  buildPublicTicketUrl('https://tickets.roundthecornerapp.com/', 'abc_123'),
  'https://tickets.roundthecornerapp.com/t/abc_123'
);
assert.throws(() => buildPublicTicketUrl('http://example.com', 'abc'), /HTTPS/);

console.log('ticket token helper tests passed');
