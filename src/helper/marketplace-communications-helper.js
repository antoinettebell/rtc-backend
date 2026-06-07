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

const buildEmailHtml = ({ title, body }) => `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
    <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
    <p style="margin:0 0 16px">${escapeHtml(body)}</p>
    <p style="margin:0;color:#6b7280">Open Round The Corner to view the latest event details.</p>
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
        title,
        buildEmailHtml({ title, body })
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
