const assert = require('assert');
const {
  normalizeCoordinatorSocialMedia,
  normalizeSocialMediaHandle,
  normalizeVendorSocialMedia,
} = require('./social-media-handle');

assert.strictEqual(normalizeSocialMediaHandle('rounddacorner', 'instagram'), 'rounddacorner');
assert.strictEqual(normalizeSocialMediaHandle('@rounddacorner', 'x'), 'rounddacorner');
assert.strictEqual(normalizeSocialMediaHandle('PageName', 'facebook'), 'PageName');
assert.throws(
  () => normalizeSocialMediaHandle('https://www.tiktok.com/@rounddacorner', 'tiktok'),
  /without a link/
);
assert.throws(() => normalizeSocialMediaHandle('not a handle/link', 'threads'), /valid threads handle/);

assert.deepStrictEqual(normalizeCoordinatorSocialMedia({ instagram: ' rtc ', facebook: '@RTCEats' }), {
  instagram: 'rtc',
  facebook: 'RTCEats',
  x: null,
  threads: null,
  tiktok: null,
});

assert.deepStrictEqual(normalizeVendorSocialMedia([
  { mediaType: 'TWITTER', mediaUrl: 'https://twitter.com/rounddacorner' },
  { mediaType: 'INSTAGRAM', mediaUrl: '@rtc.eats' },
]), {
  instagram: 'rtc.eats',
  facebook: null,
  x: 'rounddacorner',
  threads: null,
  tiktok: null,
});

console.log('Social media handle helper tests passed.');
