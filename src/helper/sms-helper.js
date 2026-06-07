const https = require('https');
const { twilio } = require('../config');

const isBlank = (value) => !String(value || '').trim();

const isConfigured = () =>
  twilio?.enabled &&
  !isBlank(twilio.accountSid) &&
  !isBlank(twilio.authToken) &&
  !isBlank(twilio.messagingServiceSid);

const normalizePhoneNumber = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith('+')) {
    return raw;
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return null;
};

const postTwilioMessage = ({ to, body }) =>
  new Promise((resolve, reject) => {
    const payload = new URLSearchParams({
      To: to,
      Body: body,
      MessagingServiceSid: twilio.messagingServiceSid,
    }).toString();

    const req = https.request(
      {
        method: 'POST',
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`,
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${twilio.accountSid}:${twilio.authToken}`
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseBody ? JSON.parse(responseBody) : {});
            return;
          }

          const error = new Error(`Twilio SMS failed with status ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.responseBody = responseBody;
          reject(error);
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });

exports.sendSms = async ({ to, body, metadata = {} }) => {
  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo || isBlank(body)) {
    return { skipped: true, reason: 'missing_recipient_or_body' };
  }

  if (!isConfigured()) {
    console.log('Twilio SMS skipped: not configured or disabled', metadata);
    return { skipped: true, reason: 'not_configured' };
  }

  try {
    return await postTwilioMessage({ to: normalizedTo, body });
  } catch (error) {
    console.error('Twilio SMS send failed', {
      ...metadata,
      statusCode: error.statusCode,
      message: error.message,
    });
    return { skipped: false, failed: true, reason: error.message };
  }
};

exports.normalizePhoneNumber = normalizePhoneNumber;
exports.isConfigured = isConfigured;
