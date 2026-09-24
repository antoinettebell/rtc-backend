const assert = require('assert');
const {
  ACTIVE_TICKET_STAFF_STATUSES,
  canResendTicketStaffInvitation,
  canRevokeTicketStaffAccess,
  buildTicketStaffNotification,
} = require('./marketplace-ticket-staff-helper');

assert.deepEqual(ACTIVE_TICKET_STAFF_STATUSES, ['PENDING', 'ACCEPTED']);
assert.equal(canResendTicketStaffInvitation('PENDING'), true);
assert.equal(canResendTicketStaffInvitation('DECLINED'), true);
assert.equal(canResendTicketStaffInvitation('REVOKED'), true);
assert.equal(canResendTicketStaffInvitation('ACCEPTED'), false);
assert.equal(canResendTicketStaffInvitation('EXPIRED'), false);
assert.equal(canRevokeTicketStaffAccess('PENDING'), true);
assert.equal(canRevokeTicketStaffAccess('ACCEPTED'), true);
assert.equal(canRevokeTicketStaffAccess('DECLINED'), false);
assert.equal(canRevokeTicketStaffAccess('REVOKED'), false);
assert.equal(canRevokeTicketStaffAccess('EXPIRED'), false);

const notification = buildTicketStaffNotification({
  assignmentId: 'assignment-123',
  eventId: 'event-456',
  title: 'Ticket staff invitation',
  body: 'Open the app to respond.',
});
assert.deepEqual(notification.channels, ['push']);
assert.equal(notification.data.notificationType, 'MARKETPLACE_TICKET_STAFF');
assert.equal(notification.data.deepLink, 'rtc-customer://ticket-staff/assignment-123');
assert.equal(notification.data.eventId, 'event-456');
assert.equal(notification.data.availableActions, 'ACCEPT,DECLINE');

console.log('Marketplace ticket staff helper tests passed.');
