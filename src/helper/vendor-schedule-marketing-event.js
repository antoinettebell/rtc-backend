const { randomUUID } = require('crypto');
const { QueueClient } = require('@azure/storage-queue');

const EVENT_TYPE = 'VENDOR_SCHEDULE_CHANGED';
const SAFE_QUEUE_NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const SAFE_ID = /^[a-f0-9]{24}$/i;

let queueClient;

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw Object.assign(new Error(`${name} is required.`), {
    code: 'VENDOR_SCHEDULE_EVENT_CONFIGURATION_MISSING',
  });
  return value;
};

const defaultClient = () => {
  if (queueClient) return queueClient;
  const queueName = required('VENDOR_SPOTLIGHT_SCHEDULE_QUEUE_NAME');
  if (!SAFE_QUEUE_NAME.test(queueName)) {
    throw Object.assign(new Error('Queue name is invalid.'), {
      code: 'VENDOR_SCHEDULE_EVENT_CONFIGURATION_INVALID',
    });
  }
  queueClient = QueueClient.fromConnectionString(
    required('VENDOR_SPOTLIGHT_QUEUE_CONNECTION'),
    queueName,
    { messageEncoding: 'base64' }
  );
  return queueClient;
};

const safeId = (value) => {
  const id = String(value || '');
  if (!SAFE_ID.test(id)) {
    throw Object.assign(new Error('vendorId is invalid.'), {
      code: 'VENDOR_SCHEDULE_EVENT_VENDOR_INVALID',
    });
  }
  return id;
};

const buildVendorScheduleChangedEvent = (vendorId, now = new Date(), eventId = randomUUID()) => ({
  vendorId: safeId(vendorId),
  eventType: EVENT_TYPE,
  occurredAt: new Date(now).toISOString(),
  eventId,
});

const publishVendorScheduleChanged = async (
  vendorId,
  { client = defaultClient(), now = new Date(), eventId } = {}
) => {
  const event = buildVendorScheduleChangedEvent(vendorId, now, eventId);
  await client.sendMessage(JSON.stringify(event));
  return { eventId: event.eventId, eventType: event.eventType };
};

const safeFailureCode = (error) => (
  typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.code)
    ? error.code
    : 'VENDOR_SCHEDULE_EVENT_PUBLISH_FAILED'
);

const saveFoodTruckUpdateWithScheduleEvent = async ({
  item,
  scheduleChanged,
  publish = publishVendorScheduleChanged,
  logError = console.error,
}) => {
  await item.save();
  if (!scheduleChanged) return { scheduleEvent: 'NOT_REQUIRED' };
  const vendorId = String(item._id || '');
  try {
    const result = await publish(vendorId);
    return { scheduleEvent: 'ENQUEUED', eventId: result.eventId };
  } catch (error) {
    logError('Vendor schedule marketing notification failed', {
      vendorId,
      code: safeFailureCode(error),
    });
    return { scheduleEvent: 'MISSED', code: safeFailureCode(error) };
  }
};

module.exports = {
  EVENT_TYPE,
  buildVendorScheduleChangedEvent,
  publishVendorScheduleChanged,
  saveFoodTruckUpdateWithScheduleEvent,
};
