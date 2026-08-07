const assert = require('assert');
const validation = require('./marketplace-validation');

const partial = validation.updateEvent.body.validate({ event_name: 'Updated Name' });
assert.ifError(partial.error);
assert.deepStrictEqual(partial.value, { event_name: 'Updated Name' });
assert.strictEqual(partial.value.vip_section_enabled, undefined);
assert.strictEqual(partial.value.ticket_sales_enabled, undefined);
assert.strictEqual(partial.value.catered_vip_section_enabled, undefined);

const created = validation.createEvent.body.validate({ event_name: 'New Event' });
assert.ifError(created.error);
assert.strictEqual(created.value.vip_section_enabled, false);

console.log('marketplace partial update validation tests passed');
