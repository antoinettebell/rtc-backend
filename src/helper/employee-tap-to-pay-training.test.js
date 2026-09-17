const assert = require('assert');
const {
  REQUIRED_ITEMS,
  acknowledgeTraining,
  buildTrainingStatus,
} = require('./employee-tap-to-pay-training');

const now = new Date('2026-09-17T16:00:00.000Z');
const employee = {
  first_name: 'Devon',
  last_name: 'Douglas',
  tap_to_pay_training_acknowledgments: [],
};

assert.deepStrictEqual(buildTrainingStatus(employee, now).score, 0);

acknowledgeTraining({
  employee,
  typedName: '  devon   douglas ',
  signedDate: '2026-09-17',
  checkedItems: REQUIRED_ITEMS,
  now,
});

const current = buildTrainingStatus(employee, now);
assert.strictEqual(current.compliant, true);
assert.strictEqual(current.score, 100);
assert.strictEqual(current.current.signed_name, 'Devon Douglas');
assert.strictEqual(
  new Date(current.current.expires_at).toISOString(),
  '2027-09-17T16:00:00.000Z'
);

const expired = buildTrainingStatus(
  employee,
  new Date('2027-09-17T16:00:00.001Z')
);
assert.strictEqual(expired.compliant, false);
assert.strictEqual(expired.score, 0);
assert.strictEqual(expired.history[0].is_archived, true);

assert.throws(
  () =>
    acknowledgeTraining({
      employee,
      typedName: 'Someone Else',
      signedDate: '2027-09-18',
      checkedItems: REQUIRED_ITEMS,
      now: new Date('2027-09-18T16:00:00.000Z'),
    }),
  /must match/
);

assert.throws(
  () =>
    acknowledgeTraining({
      employee,
      typedName: 'Devon Douglas',
      signedDate: '2027-09-18',
      checkedItems: REQUIRED_ITEMS.slice(0, 4),
      now: new Date('2027-09-18T16:00:00.000Z'),
    }),
  /every Tap to Pay training item/
);

console.log('employee Tap to Pay training tests passed');
