const assert = require('assert');
const Validation = require('./marketplace-validation');

const schema = Validation.answerEventQuestion.body;
assert(schema.validate({ answer_text: 'ok' }).error, 'two-character answers are rejected');
assert.ifError(schema.validate({ answer_text: 'okay' }).error);
assert.ifError(schema.validate({ answer_text: '  okay  ' }).error);

console.log('marketplace message validation tests passed');
