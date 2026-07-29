const https = require('https');
const { twilio } = require('../config');

const isBlank = (value) => !String(value || '').trim();
const E164_PHONE_RE = /^\+[1-9]\d{1,14}$/;

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
    const normalized = `+${raw.slice(1).replace(/\D/g, '')}`;
    return E164_PHONE_RE.test(normalized) ? normalized : null;
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    const normalized = `+1${digits}`;
    return E164_PHONE_RE.test(normalized) ? normalized : null;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    const normalized = `+${digits}`;
    return E164_PHONE_RE.test(normalized) ? normalized : null;
  }

  return null;
};

const maskPhoneNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return '[missing]';
  }

  const lastFour = digits.slice(-4);
  return `***${lastFour}`;
};

const parseTwilioResponse = (responseBody) => {
  if (!responseBody) {
    return {};
  }

  try {
    return JSON.parse(responseBody);
  } catch (error) {
    return { rawBody: responseBody };
  }
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
          const parsedResponse = parseTwilioResponse(responseBody);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsedResponse);
            return;
          }

          const error = new Error(`Twilio SMS failed with status ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.twilioCode = parsedResponse.code;
          error.twilioMessage = parsedResponse.message;
          error.moreInfo = parsedResponse.more_info;
          error.responseBody = parsedResponse.rawBody;
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
  if (!normalizedTo) {
    console.log('Twilio SMS skipped: invalid recipient', {
      ...metadata,
      maskedTo: maskPhoneNumber(to),
    });
    return { skipped: true, reason: 'invalid_recipient' };
  }

  if (isBlank(body)) {
    return { skipped: true, reason: 'missing_body' };
  }

  if (!isConfigured()) {
    console.log('Twilio SMS skipped: not configured or disabled', metadata);
    return { skipped: true, reason: 'not_configured' };
  }

  try {
    const result = await postTwilioMessage({ to: normalizedTo, body });
    console.log('Twilio SMS accepted', {
      ...metadata,
      messageSid: result.sid,
      messageStatus: result.status,
      maskedTo: maskPhoneNumber(normalizedTo),
    });
    return result;
  } catch (error) {
    console.error('Twilio SMS send failed', {
      ...metadata,
      statusCode: error.statusCode,
      twilioCode: error.twilioCode,
      twilioMessage: error.twilioMessage,
      moreInfo: error.moreInfo,
      message: error.message,
    });
    return {
      skipped: false,
      failed: true,
      reason: error.message,
      statusCode: error.statusCode,
      twilioCode: error.twilioCode,
    };
  }
};

exports.normalizePhoneNumber = normalizePhoneNumber;
exports.maskPhoneNumber = maskPhoneNumber;
exports.isConfigured = isConfigured;
exports.parseTwilioResponse = parseTwilioResponse;
