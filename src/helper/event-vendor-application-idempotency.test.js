const assert = require('assert');
const {
  findOrCreateEventVendorApplication,
} = require('./event-vendor-application-idempotency');

(async () => {
  const existing = { application_id: 'existing' };
  let creates = 0;
  let result = await findOrCreateEventVendorApplication({
    model: {
      findOne: async () => existing,
      create: async () => { creates += 1; },
    },
    query: { event_id: 'event-1', vendor_user_id: 'vendor-1' },
    payload: {},
  });
  assert.equal(result.application, existing);
  assert.equal(result.alreadySubmitted, true);
  assert.equal(creates, 0);

  const created = { application_id: 'created' };
  result = await findOrCreateEventVendorApplication({
    model: {
      findOne: async () => null,
      create: async () => created,
    },
    query: {},
    payload: { value: true },
  });
  assert.equal(result.application, created);
  assert.equal(result.alreadySubmitted, false);

  let lookups = 0;
  const raced = { application_id: 'raced' };
  result = await findOrCreateEventVendorApplication({
    model: {
      findOne: async () => (++lookups === 1 ? null : raced),
      create: async () => { throw Object.assign(new Error('duplicate'), { code: 11000 }); },
    },
    query: {},
    payload: {},
  });
  assert.equal(result.application, raced);
  assert.equal(result.alreadySubmitted, true);

  console.log('event vendor application idempotency tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
