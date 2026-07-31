const assert = require('assert');
const {
  buildPublicReviewUrl,
  validatePublicReviewUrl,
} = require('./review-url-helper');
const { PUBLIC_REVIEW_HTML } = require('./public-review-page');

process.env.NODE_ENV = 'production';

assert.equal(
  buildPublicReviewUrl(
    'secure token/value',
    'https://reviews.roundthecornerapp.com/'
  ),
  'https://reviews.roundthecornerapp.com/review?token=secure+token%2Fvalue'
);
assert.equal(buildPublicReviewUrl('token', 'http://localhost:3000'), null);
assert.equal(buildPublicReviewUrl('token', 'http://reviews.example.com'), null);
assert.equal(buildPublicReviewUrl('', 'https://reviews.example.com'), null);
assert.equal(validatePublicReviewUrl('not a url'), null);
assert.match(PUBLIC_REVIEW_HTML, /1 to 5 stars/);
assert.match(PUBLIC_REVIEW_HTML, /\/api\/v1\/public\/review-token\//);
assert.doesNotMatch(PUBLIC_REVIEW_HTML, /TWILIO_AUTH_TOKEN/);

console.log('review URL and public page tests passed');
