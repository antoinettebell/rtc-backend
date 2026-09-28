const assert = require('assert');
const templates = require('./templates');

const renderedTemplates = Object.values(templates)
  .filter((value) => typeof value === 'string')
  .join('\n');

assert.doesNotMatch(renderedTemplates, /ft-media-storage\.s3\.us-east-1\.amazonaws\.com/);
assert.match(
  templates.OTP_VERIFICATION_TEMPLATE,
  /https:\/\/admin\.rounddacornerapp\.com\/logo-tree\.png/
);
assert.match(templates.OTP_VERIFICATION_TEMPLATE, /alt="Round Da' Corner"/);

console.log('email template asset tests passed');
