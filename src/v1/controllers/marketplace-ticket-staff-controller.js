const {
  MarketplaceEventModel,
  MarketplaceTicketStaffAssignmentModel,
  MarketplaceScannerSessionModel,
  UserModel,
} = require('../../models');
const { createTicketToken } = require('../../helper/ticket-token-helper');
const { eventStartUtc, isScannerAvailable } = require('../../helper/event-ticket-helper');
const MarketplaceCommunications = require('../../helper/marketplace-communications-helper');
const {
  canResendTicketStaffInvitation,
  canRevokeTicketStaffAccess,
  buildTicketStaffNotification,
} = require('../../helper/marketplace-ticket-staff-helper');
const { server } = require('../../config');

const fail = (message, code = 400) => Object.assign(new Error(message), { code });
const eventEndsAt = (event) => eventStartUtc({
  eventDate: event.event_end_date || event.event_date,
  eventTime: event.event_end_time || event.event_time || '23:59',
  timeZone: event.event_timezone || 'America/New_York',
});
const expireAssignment = async (assignment) => {
  if (assignment.status !== 'EXPIRED' && assignment.expires_at <= new Date()) {
    assignment.status = 'EXPIRED';
    assignment.action_source = 'SYSTEM';
    await assignment.save();
  }
  return assignment;
};
const findExistingCustomer = async (identifier) => {
  const value = String(identifier || '').trim();
  if (!value) throw fail('Enter an existing customer email or mobile number.');
  const digits = value.replace(/\D/g, '');
  const customer = await UserModel.findOne({
    userType: 'CUSTOMER',
    inactive: { $ne: true },
    ...(value.includes('@')
      ? { email: { $regex: `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
      : { mobileNumber: digits }),
  });
  if (!customer) throw fail('No active Round Da\' Corner customer account matches that email or mobile number.', 404);
  return customer;
};
const createOrReactivateInvitation = async ({ event, customer, coordinatorUserId, source }) => {
  const expiresAt = eventEndsAt(event);
  if (expiresAt <= new Date()) throw fail('This event has ended.', 409);
  let assignment = await MarketplaceTicketStaffAssignmentModel.findOne({ event_id: event.event_id, staff_customer_user_id: customer._id });
  if (assignment && ['PENDING', 'ACCEPTED'].includes(assignment.status)) throw fail('This customer is already assigned to the event.', 409);
  assignment = assignment || new MarketplaceTicketStaffAssignmentModel({
    event_id: event.event_id,
    coordinator_user_id: coordinatorUserId,
    staff_customer_user_id: customer._id,
    expires_at: expiresAt,
  });
  assignment.coordinator_user_id = coordinatorUserId;
  assignment.status = 'PENDING';
  assignment.action_source = source;
  assignment.invited_at = new Date();
  assignment.responded_at = null;
  assignment.revoked_at = null;
  assignment.expires_at = expiresAt;
  await assignment.save();
  await notifyInvitee(assignment, event, 'Ticket staff invitation', `You were invited to scan tickets for ${event.event_name}. Open Round Da' Corner to accept or decline.`);
  return assignment;
};
const notifyInvitee = (assignment, event, title, body) => MarketplaceCommunications.sendMarketplaceCommunication({
  userId: assignment.staff_customer_user_id,
  ...buildTicketStaffNotification({ assignmentId: assignment.assignment_id, eventId: event.event_id, title, body }),
});

exports.listForEvent = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({ event_id: req.params.eventId, customer_user_id: req.user._id }).lean();
    if (!event) throw fail('Event not found', 404);
    const rows = await MarketplaceTicketStaffAssignmentModel.find({ event_id: event.event_id }).populate('staff_customer_user_id', 'firstName lastName email mobileNumber').sort({ invited_at: -1 });
    await Promise.all(rows.map(expireAssignment));
    return res.data({ assignmentList: rows }, 'Assigned Ticket Staff');
  } catch (e) { return next(e); }
};

exports.assign = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({ event_id: req.params.eventId, customer_user_id: req.user._id });
    if (!event) throw fail('Event not found', 404);
    if (!event.ticket_sales_enabled) throw fail('Assigned Ticket Staff is available only for ticketed events.', 409);
    const customer = await findExistingCustomer(req.body.identifier);
    if (String(customer._id) === String(req.user._id)) throw fail('The event coordinator already has ticket-scanning access.');
    const assignment = await createOrReactivateInvitation({ event, customer, coordinatorUserId: req.user._id, source: 'COORDINATOR' });
    return res.data({ assignment }, 'Ticket staff invitation sent');
  } catch (e) { return next(e); }
};

exports.resend = async (req, res, next) => {
  try {
    const assignment = await MarketplaceTicketStaffAssignmentModel.findOne({ assignment_id: req.params.assignmentId, coordinator_user_id: req.user._id, status: { $in: ['PENDING', 'DECLINED', 'REVOKED'] } });
    if (!assignment || !canResendTicketStaffInvitation(assignment.status)) throw fail('Ticket staff invitation cannot be resent.', 404);
    const event = await MarketplaceEventModel.findOne({ event_id: assignment.event_id }).lean();
    assignment.status = 'PENDING'; assignment.action_source = 'COORDINATOR'; assignment.invited_at = new Date(); assignment.reminder_sent_at = new Date(); assignment.responded_at = null; assignment.revoked_at = null; await assignment.save();
    await notifyInvitee(assignment, event, 'Ticket staff invitation reminder', `Please accept or decline the ticket staff invitation for ${event.event_name}.`);
    return res.data({ assignment }, 'Ticket staff invitation resent');
  } catch (e) { return next(e); }
};

exports.revoke = async (req, res, next) => {
  try {
    const assignment = await MarketplaceTicketStaffAssignmentModel.findOne({ assignment_id: req.params.assignmentId, coordinator_user_id: req.user._id, status: { $in: ['PENDING', 'ACCEPTED'] } });
    if (!assignment || !canRevokeTicketStaffAccess(assignment.status)) throw fail('Active ticket staff assignment not found.', 404);
    assignment.status = 'REVOKED'; assignment.action_source = 'COORDINATOR'; assignment.revoked_at = new Date(); await assignment.save();
    await MarketplaceScannerSessionModel.updateMany({ event_id: assignment.event_id, assigned_staff_user_id: assignment.staff_customer_user_id, revoked_at: null }, { $set: { revoked_at: new Date() } });
    const event = await MarketplaceEventModel.findOne({ event_id: assignment.event_id }).lean();
    await notifyInvitee(assignment, event, 'Ticket staff access revoked', `Your ticket-scanning access for ${event.event_name} was revoked.`);
    return res.data({ assignment }, 'Ticket staff assignment revoked');
  } catch (e) { return next(e); }
};

exports.myInvitations = async (req, res, next) => {
  try {
    const rows = await MarketplaceTicketStaffAssignmentModel.find({ staff_customer_user_id: req.user._id, status: { $in: ['PENDING', 'ACCEPTED'] } }).sort({ invited_at: -1 });
    await Promise.all(rows.map(expireAssignment));
    const events = await MarketplaceEventModel.find({ event_id: { $in: rows.map((row) => row.event_id) } }).select('event_id event_name event_date event_time event_end_date event_end_time event_timezone event_address event_city event_state').lean();
    const byId = new Map(events.map((event) => [event.event_id, event]));
    return res.data({ assignmentList: rows.map((row) => ({ ...row.toObject(), marketplaceEvent: byId.get(row.event_id) || null })) }, 'Ticket staff invitations');
  } catch (e) { return next(e); }
};

exports.respond = async (req, res, next) => {
  try {
    const response = String(req.body.response || '').toUpperCase();
    if (!['ACCEPTED', 'DECLINED'].includes(response)) throw fail('Accept or decline the invitation.');
    const assignment = await MarketplaceTicketStaffAssignmentModel.findOne({ assignment_id: req.params.assignmentId, staff_customer_user_id: req.user._id, status: 'PENDING', expires_at: { $gt: new Date() } });
    if (!assignment) throw fail('Pending ticket staff invitation not found.', 404);
    assignment.status = response; assignment.action_source = 'INVITEE'; assignment.responded_at = new Date(); await assignment.save();
    return res.data({ assignment }, `Ticket staff invitation ${response.toLowerCase()}`);
  } catch (e) { return next(e); }
};

exports.createScannerSession = async (req, res, next) => {
  try {
    const assignment = await MarketplaceTicketStaffAssignmentModel.findOne({ assignment_id: req.params.assignmentId, staff_customer_user_id: req.user._id, status: 'ACCEPTED', expires_at: { $gt: new Date() } });
    if (!assignment) throw fail('Active ticket staff assignment not found.', 403);
    const event = await MarketplaceEventModel.findOne({ event_id: assignment.event_id }).lean();
    if (!event || !isScannerAvailable({ eventDate: event.event_date, eventTime: event.event_time, timeZone: event.event_timezone, closedAt: event.ticket_scanning_closed_at })) throw fail('Ticket scanning is not currently available', 403);
    const { token, tokenHash } = createTicketToken();
    await MarketplaceScannerSessionModel.create({ session_token_hash: tokenHash, event_id: event.event_id, coordinator_user_id: assignment.coordinator_user_id, assigned_staff_user_id: req.user._id, action_source: 'INVITEE', expires_at: assignment.expires_at });
    return res.data({ scanner_url: `${server.publicTicketBaseURL}/check-in/${encodeURIComponent(token)}` }, 'Ticket staff scanner session created');
  } catch (e) { return next(e); }
};

exports.adminList = async (_req, res, next) => {
  try {
    const rows = await MarketplaceTicketStaffAssignmentModel.find({}).populate('coordinator_user_id', 'firstName lastName email').populate('staff_customer_user_id', 'firstName lastName email mobileNumber').sort({ createdAt: -1 }).limit(500);
    await Promise.all(rows.map(expireAssignment));
    const events = await MarketplaceEventModel.find({ event_id: { $in: rows.map((row) => row.event_id) } })
      .select('event_id event_name event_date event_time event_timezone')
      .lean();
    const eventsById = new Map(events.map((event) => [event.event_id, event]));
    return res.data({
      assignmentList: rows.map((row) => ({
        ...row.toObject(),
        marketplaceEvent: eventsById.get(row.event_id) || null,
      })),
    }, 'Assigned Ticket Staff administration');
  } catch (e) { return next(e); }
};

exports.adminAssign = async (req, res, next) => {
  try {
    const event = await MarketplaceEventModel.findOne({ event_id: req.params.eventId });
    if (!event) throw fail('Event not found', 404);
    if (!event.ticket_sales_enabled) throw fail('Assigned Ticket Staff is available only for ticketed events.', 409);
    const customer = await findExistingCustomer(req.body.identifier);
    if (String(customer._id) === String(event.customer_user_id)) throw fail('The event coordinator already has ticket-scanning access.');
    const assignment = await createOrReactivateInvitation({ event, customer, coordinatorUserId: event.customer_user_id, source: 'ADMIN' });
    return res.data({ assignment }, 'Ticket staff invitation sent');
  } catch (e) { return next(e); }
};

exports.adminResend = async (req, res, next) => {
  try {
    const assignment = await MarketplaceTicketStaffAssignmentModel.findOne({ assignment_id: req.params.assignmentId, status: { $in: ['PENDING', 'DECLINED', 'REVOKED'] } });
    if (!assignment || !canResendTicketStaffInvitation(assignment.status)) throw fail('Ticket staff invitation cannot be resent.', 404);
    const event = await MarketplaceEventModel.findOne({ event_id: assignment.event_id }).lean();
    if (!event || eventEndsAt(event) <= new Date()) throw fail('This event has ended.', 409);
    assignment.status = 'PENDING'; assignment.action_source = 'ADMIN'; assignment.invited_at = new Date(); assignment.reminder_sent_at = new Date(); assignment.responded_at = null; assignment.revoked_at = null; await assignment.save();
    await notifyInvitee(assignment, event, 'Ticket staff invitation reminder', `Please accept or decline the ticket staff invitation for ${event.event_name}.`);
    return res.data({ assignment }, 'Ticket staff invitation resent');
  } catch (e) { return next(e); }
};

exports.adminRevoke = async (req, res, next) => {
  try {
    const assignment = await MarketplaceTicketStaffAssignmentModel.findOne({ assignment_id: req.params.assignmentId, status: { $in: ['PENDING', 'ACCEPTED'] } });
    if (!assignment || !canRevokeTicketStaffAccess(assignment.status)) throw fail('Active ticket staff assignment not found.', 404);
    assignment.status = 'REVOKED'; assignment.action_source = 'ADMIN'; assignment.revoked_at = new Date(); await assignment.save();
    await MarketplaceScannerSessionModel.updateMany({ event_id: assignment.event_id, assigned_staff_user_id: assignment.staff_customer_user_id, revoked_at: null }, { $set: { revoked_at: new Date() } });
    const event = await MarketplaceEventModel.findOne({ event_id: assignment.event_id }).lean();
    await notifyInvitee(assignment, event, 'Ticket staff access revoked', `Your ticket-scanning access for ${event.event_name} was revoked.`);
    return res.data({ assignment }, 'Ticket staff assignment revoked');
  } catch (e) { return next(e); }
};
