const crypto = require('crypto');
const { docusign } = require('../../config');

const acceptedStatuses = new Set([
  'completed',
  'declined',
  'voided',
  'delivery_failed',
  'failed',
]);

const statusAliases = {
  'envelope-completed': 'completed',
  'envelope-declined': 'declined',
  'envelope-voided': 'voided',
  'envelope-delivery-failed': 'delivery_failed',
  'recipient-delivery-failed': 'delivery_failed',
};

const getHeader = (headers, name) =>
  headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];

const parseBody = (body) => {
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString('utf8') || '{}');
  }
  return body || {};
};

const safeCompare = (left, right) => {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const verifySignature = ({ rawBody, headers }) => {
  if (!docusign.webhookSecret) {
    return { configured: false, valid: true };
  }

  const signature = getHeader(headers, 'x-docusign-signature-1');
  if (!signature || !Buffer.isBuffer(rawBody)) {
    return { configured: true, valid: false };
  }

  const expected = crypto
    .createHmac('sha256', docusign.webhookSecret)
    .update(rawBody)
    .digest('base64');

  return {
    configured: true,
    valid: safeCompare(signature, expected),
  };
};

const getEnvelopeId = (payload) =>
  payload?.data?.envelopeId ||
  payload?.envelopeId ||
  payload?.EnvelopeStatus?.EnvelopeID ||
  null;

const getStatus = (payload) => {
  const rawStatus = String(
    payload?.data?.envelopeSummary?.status ||
      payload?.data?.status ||
      payload?.status ||
      payload?.event ||
      payload?.EnvelopeStatus?.Status ||
      ''
  )
    .trim()
    .toLowerCase();
  return statusAliases[rawStatus] || rawStatus;
};

exports.docusign = async (req, res) => {
  const timestamp = new Date().toISOString();
  const signature = verifySignature({
    rawBody: req.body,
    headers: req.headers || {},
  });

  if (signature.configured && !signature.valid) {
    console.warn('[DocuSign webhook] signature validation failed', {
      timestamp,
    });
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  let payload;
  try {
    payload = parseBody(req.body);
  } catch (error) {
    console.warn('[DocuSign webhook] invalid JSON payload', {
      timestamp,
      signatureValid: signature.valid,
    });
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }

  const envelopeId = getEnvelopeId(payload);
  const status = getStatus(payload);
  const accepted = acceptedStatuses.has(status);

  console.log('[DocuSign webhook] event received', {
    timestamp,
    envelopeId,
    status,
    signatureValid: signature.valid,
    signatureConfigured: signature.configured,
  });

  if (!envelopeId || !status) {
    return res.status(400).json({
      success: false,
      message: 'Missing envelope status',
    });
  }

  if (!accepted) {
    return res.data(
      {
        received: true,
        accepted: false,
        envelopeId,
        status,
      },
      'DocuSign webhook event ignored'
    );
  }

  // Later phase: connect this accepted event to marketplace bid agreement records.
  return res.data(
    {
      received: true,
      accepted: true,
      envelopeId,
      status,
    },
    'DocuSign webhook received'
  );
};
