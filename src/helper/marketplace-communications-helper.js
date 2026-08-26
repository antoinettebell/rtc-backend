const CustomNotification = require('./custom-notification');
const MailHelper = require('./mail-helper');
const SmsHelper = require('./sms-helper');
const { UserService } = require('../v1/services');

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getRecipientName = (recipient) =>
  recipient?.firstName || recipient?.first_name || recipient?.name || 'there';

const buildEmailHtml = ({ title, body, recipientName }) => `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
    <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
    <p style="margin:0 0 16px">Hi ${escapeHtml(recipientName || 'there')},</p>
    <p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(body)}</p>
    <p style="margin:24px 0 0">For help, contact Round Da’ Corner Support at 800-410-7053.</p>
    <p style="margin:16px 0 0">Best Regards,<br>Round Da' Corner Support Team</p>
  </div>
`;

const loadUser = async (userOrId) => {
  if (!userOrId) {
    return null;
  }

  if (typeof userOrId === 'object' && userOrId._id) {
    return userOrId;
  }

  return UserService.getById(userOrId);
};

exports.sendMarketplaceCommunication = async ({
  user,
  userId,
  title,
  body,
  emailSubject = null,
  emailBody = null,
  data = {},
  channels = ['push', 'email'],
  smsBody = null,
  recipientPhone = null,
  metadata = {},
}) => {
  const recipient = await loadUser(user || userId);
  const recipientId = recipient?._id || userId;

  if (!recipientId || !title || !body) {
    return { skipped: true, reason: 'missing_required_fields' };
  }

  const results = {};

  if (channels.includes('push')) {
    try {
      await CustomNotification.sendNotificationToUsers({
        [String(recipientId)]: {
          title,
          body,
          data,
        },
      });
      results.push = true;
    } catch (error) {
      console.error('Marketplace push notification failed', {
        ...metadata,
        userId: String(recipientId),
        message: error.message,
      });
      results.push = false;
    }
  }

  if (channels.includes('email') && recipient?.email) {
    try {
      await MailHelper.sendMail(
        recipient.email,
        emailSubject || title,
        buildEmailHtml({
          title: emailSubject || title,
          body: emailBody || body,
          recipientName: getRecipientName(recipient),
        })
      );
      results.email = true;
    } catch (error) {
      console.error('Marketplace email notification failed', {
        ...metadata,
        userId: String(recipientId),
        message: error.message,
      });
      results.email = false;
    }
  }

  if (channels.includes('sms')) {
    results.sms = await SmsHelper.sendSms({
      to: recipientPhone || recipient?.mobileNumber,
      body: smsBody || body,
      metadata: {
        ...metadata,
        userId: String(recipientId),
      },
    });
  }

  return results;
};

exports.sendMarketplaceCommunications = async (items = []) =>
  Promise.all(items.map((item) => exports.sendMarketplaceCommunication(item)));
