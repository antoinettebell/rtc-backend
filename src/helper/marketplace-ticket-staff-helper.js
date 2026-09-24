const ACTIVE_TICKET_STAFF_STATUSES = Object.freeze(['PENDING', 'ACCEPTED']);
const RESENDABLE_TICKET_STAFF_STATUSES = Object.freeze(['PENDING', 'DECLINED', 'REVOKED']);
const REVOCABLE_TICKET_STAFF_STATUSES = ACTIVE_TICKET_STAFF_STATUSES;

const canResendTicketStaffInvitation = (status) => RESENDABLE_TICKET_STAFF_STATUSES.includes(status);
const canRevokeTicketStaffAccess = (status) => REVOCABLE_TICKET_STAFF_STATUSES.includes(status);

const buildTicketStaffNotification = ({ assignmentId, eventId, title, body }) => ({
  title,
  body,
  data: {
    notificationType: 'MARKETPLACE_TICKET_STAFF',
    assignmentId,
    eventId,
    deepLink: `rtc-customer://ticket-staff/${assignmentId}`,
    availableActions: 'ACCEPT,DECLINE',
  },
  channels: ['push'],
  metadata: { assignmentId, eventId },
});

module.exports = {
  ACTIVE_TICKET_STAFF_STATUSES,
  RESENDABLE_TICKET_STAFF_STATUSES,
  REVOCABLE_TICKET_STAFF_STATUSES,
  canResendTicketStaffInvitation,
  canRevokeTicketStaffAccess,
  buildTicketStaffNotification,
};
