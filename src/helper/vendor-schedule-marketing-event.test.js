const assert = require('node:assert/strict');
const test = require('node:test');

const {
  EVENT_TYPE,
  buildVendorScheduleChangedEvent,
  publishVendorScheduleChanged,
  saveFoodTruckUpdateWithScheduleEvent,
} = require('./vendor-schedule-marketing-event');

const VENDOR_ID = '66f000000000000000000001';

test('builds and sends only the minimal schedule-change event', async () => {
  const messages = [];
  const event = buildVendorScheduleChangedEvent(
    VENDOR_ID,
    new Date('2026-09-20T12:00:00.000Z'),
    'event-1'
  );
  assert.deepEqual(event, {
    vendorId: VENDOR_ID,
    eventType: EVENT_TYPE,
    occurredAt: '2026-09-20T12:00:00.000Z',
    eventId: 'event-1',
  });
  await publishVendorScheduleChanged(VENDOR_ID, {
    client: { async sendMessage(message) { messages.push(JSON.parse(message)); } },
    now: new Date('2026-09-20T12:00:00.000Z'),
    eventId: 'event-1',
  });
  assert.deepEqual(messages, [event]);
  assert.deepEqual(Object.keys(messages[0]).sort(), ['eventId', 'eventType', 'occurredAt', 'vendorId']);
});

test('successful schedule save emits exactly one event after save', async () => {
  const calls = [];
  const result = await saveFoodTruckUpdateWithScheduleEvent({
    item: { _id: VENDOR_ID, async save() { calls.push('save'); } },
    scheduleChanged: true,
    async publish(vendorId) { calls.push(`publish:${vendorId}`); return { eventId: 'event-1' }; },
  });
  assert.deepEqual(calls, ['save', `publish:${VENDOR_ID}`]);
  assert.equal(result.scheduleEvent, 'ENQUEUED');
});

test('failed schedule save emits no event', async () => {
  let published = 0;
  await assert.rejects(() => saveFoodTruckUpdateWithScheduleEvent({
    item: { _id: VENDOR_ID, async save() { throw new Error('SAVE_FAILED'); } },
    scheduleChanged: true,
    async publish() { published += 1; },
  }), /SAVE_FAILED/);
  assert.equal(published, 0);
});

test('queue failure does not roll back a successful schedule save', async () => {
  let saved = 0;
  const logs = [];
  const result = await saveFoodTruckUpdateWithScheduleEvent({
    item: { _id: VENDOR_ID, async save() { saved += 1; } },
    scheduleChanged: true,
    async publish() { throw Object.assign(new Error('private'), { code: 'QUEUE_UNAVAILABLE' }); },
    logError(message, fields) { logs.push({ message, fields }); },
  });
  assert.equal(saved, 1);
  assert.equal(result.scheduleEvent, 'MISSED');
  assert.deepEqual(logs[0].fields, { vendorId: VENDOR_ID, code: 'QUEUE_UNAVAILABLE' });
});

test('unchanged schedule emits no event', async () => {
  let published = 0;
  const result = await saveFoodTruckUpdateWithScheduleEvent({
    item: { _id: VENDOR_ID, async save() {} },
    scheduleChanged: false,
    async publish() { published += 1; },
  });
  assert.equal(result.scheduleEvent, 'NOT_REQUIRED');
  assert.equal(published, 0);
});
