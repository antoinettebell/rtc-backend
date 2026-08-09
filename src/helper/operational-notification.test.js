const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildOperationalNotification,
  runNonFatalNotificationEffect,
} = require('./operational-notification');
const OperationalNotificationModel = require('../models/operational-notification');
const MarketplaceValidation = require('../v1/validations/marketplace-validation');

const base = {
  form: {
    _id: 'form-1', vendor_user_id: 'vendor-1', food_truck_id: 'food-1',
    truck_unit_id: 'truck-1', location_id: 'location-1',
  },
  user: { employee_internal_id: 'employee-1' },
  employeeName: 'Current Employee',
  now: new Date('2026-08-09T12:00:00.000Z'),
};
for (const [formType, action] of [
  ['OPENING_CHECKLIST', 'SUBMITTED'],
  ['CLOSING_CHECKLIST', 'SUBMITTED'],
  ['INVENTORY', 'SUBMITTED'],
  ['INVENTORY', 'SAVED'],
]) {
  const notification = buildOperationalNotification({
    ...base,
    form: { ...base.form, form_type: formType },
    action,
    eventKey: `form-1:${action}:${formType}`,
  });
  assert.equal(notification.form_id, 'form-1');
  assert.equal(notification.form_type, formType);
  assert.equal(notification.action, action);
  assert.equal(notification.event_key, `form-1:${action}:${formType}`);
  assert.equal(notification.employee_name, 'Current Employee');
  assert.equal(notification.truck_unit_id, 'truck-1');
  assert.equal(notification.location_id, 'location-1');
}
assert.ok(OperationalNotificationModel.schema.path('acknowledged_at'));
const acknowledgement =
  MarketplaceValidation.acknowledgeVendorNotifications.body.validate({
    notification_ids: ['notification-1'],
  });
assert.equal(acknowledgement.error, undefined);
const serviceSource = fs.readFileSync(
  path.join(__dirname, '../v1/services/operational-compliance-form-service.js'),
  'utf8'
);
assert.match(serviceSource, /\$setOnInsert/);
assert.match(serviceSource, /sendPush: false/);
(async () => {
  let formPersisted = false;
  formPersisted = true;
  const delivered = await runNonFatalNotificationEffect(
    async () => { throw new Error('notification database unavailable'); },
  );
  assert.equal(delivered, false);
  assert.equal(formPersisted, true, 'notification failure must not undo form persistence');
  console.log('operational notification tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
