const assert = require('assert');
const { normalizeExternalWebLink } = require('./external-web-link');

assert.equal(
  normalizeExternalWebLink('https://www.facebook.com/RoundDaCorner'),
  'https://www.facebook.com/RoundDaCorner',
  'a complete HTTPS link is retained',
);
assert.equal(
  normalizeExternalWebLink('facebook.com/RoundDaCorner'),
  'https://facebook.com/RoundDaCorner',
  'a protocol-less Facebook link becomes an external HTTPS link',
);
assert.equal(
  normalizeExternalWebLink(' www.instagram.com/rounddacorner '),
  'https://www.instagram.com/rounddacorner',
  'a protocol-less Instagram link is normalized after trimming',
);
assert.equal(normalizeExternalWebLink('javascript:alert(1)'), null);
assert.equal(normalizeExternalWebLink('data:text/html,hello'), null);
assert.equal(normalizeExternalWebLink('mailto:vendor@example.com'), null);
assert.equal(normalizeExternalWebLink('not a link'), null);
assert.equal(normalizeExternalWebLink('https://localhost'), null);
assert.equal(normalizeExternalWebLink('https://vendor'), null);
assert.equal(normalizeExternalWebLink('http://127.0.0.1:3000'), null);
assert.equal(normalizeExternalWebLink('http://192.168.1.25'), null);
assert.equal(normalizeExternalWebLink('http://[::1]'), null);
assert.equal(normalizeExternalWebLink('https://vendor:secret@example.com'), null);
assert.equal(normalizeExternalWebLink('https://example.com/path with space'), null);

console.log('External web link helper tests passed.');
