const jwt = require('jsonwebtoken');
const { docusign } = require('../config');

const DS_SCOPE = 'signature impersonation';
const TOKEN_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

const normalizePrivateKey = (key) => {
  if (!key) return null;
  return String(key).replace(/\\n/g, '\n');
};

const assertConfigured = () => {
  const missing = [
    ['DOCUSIGN_INTEGRATION_KEY', docusign.integrationKey],
    ['DOCUSIGN_USER_ID', docusign.userId],
    ['DOCUSIGN_ACCOUNT_ID', docusign.accountId],
    ['DOCUSIGN_PRIVATE_KEY', docusign.privateKey],
    ['DOCUSIGN_BASE_PATH', docusign.basePath],
    ['DOCUSIGN_AUTH_SERVER', docusign.authServer],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`DocuSign is not configured: ${missing.join(', ')}`);
  }
};

const assertTemplateSigningConfigured = () => {
  assertConfigured();
  const missing = [
    ['DOCUSIGN_GOVERNANCE_TEMPLATE_ID', docusign.governanceTemplateId],
    ['DOCUSIGN_NDA_TEMPLATE_ID', docusign.ndaTemplateId],
    ['DOCUSIGN_SIGNER_ROLE', docusign.signerRole],
    ['DOCUSIGN_RETURN_URL', docusign.returnUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`DocuSign vendor signing is not configured: ${missing.join(', ')}`);
  }
};

const docusignFetch = async (url, options = {}) => {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.error ||
      `DocuSign request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
};

exports.getAccessToken = async () => {
  assertConfigured();

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: docusign.integrationKey,
      sub: docusign.userId,
      aud: docusign.authServer,
      iat: now,
      exp: now + 3600,
      scope: DS_SCOPE,
    },
    normalizePrivateKey(docusign.privateKey),
    { algorithm: 'RS256' }
  );

  const body = new URLSearchParams({
    grant_type: TOKEN_GRANT_TYPE,
    assertion,
  });

  const token = await docusignFetch(`https://${docusign.authServer}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  return token.access_token;
};

const buildAgreementHtml = ({ event, signerName }) => `
  <html>
    <body style="font-family: Arial, sans-serif; font-size: 12px; color: #222;">
      <h1>ROUND THE CORNER Marketplace Agreement</h1>
      <p>This marketplace ethical behavior agreement applies to the event listed below.</p>
      <p><strong>Event:</strong> ${event.event_name || event.event_id}</p>
      <p><strong>Event ID:</strong> ${event.event_id}</p>
      <p><strong>Signer:</strong> ${signerName}</p>
      <p>
        The signer agrees to communicate professionally, honor marketplace commitments,
        avoid discriminatory or deceptive practices, and follow RTC marketplace terms
        for event sourcing and vendor selection.
      </p>
      <p>Signature:</p>
      <p style="color: white;">/sn1/</p>
    </body>
  </html>
`;

exports.createMarketplaceAgreementEnvelope = async ({
  event,
  signerName,
  signerEmail,
}) => {
  const accessToken = await exports.getAccessToken();
  const html = buildAgreementHtml({ event, signerName });
  const documentBase64 = Buffer.from(html).toString('base64');
  const url = `${docusign.basePath}/v2.1/accounts/${docusign.accountId}/envelopes`;

  return docusignFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      emailSubject: `RTC Marketplace Agreement - ${event.event_name || event.event_id}`,
      documents: [
        {
          documentBase64,
          name: 'RTC Marketplace Agreement.html',
          fileExtension: 'html',
          documentId: '1',
        },
      ],
      recipients: {
        signers: [
          {
            email: signerEmail,
            name: signerName,
            recipientId: '1',
            routingOrder: '1',
            tabs: {
              signHereTabs: [
                {
                  anchorString: '/sn1/',
                  anchorUnits: 'pixels',
                  anchorYOffset: '10',
                  anchorXOffset: '20',
                },
              ],
            },
          },
        ],
      },
      status: 'sent',
    }),
  });
};

exports.createVendorMarketplaceSigningEnvelope = async ({
  vendorName,
  vendorEmail,
  vendorUserId,
  event,
  bid = null,
  application = null,
}) => {
  assertTemplateSigningConfigured();
  const accessToken = await exports.getAccessToken();
  const url = `${docusign.basePath}/v2.1/accounts/${docusign.accountId}/envelopes`;
  const clientUserId = String(vendorUserId);
  const templateRoles = [
    {
      email: vendorEmail,
      name: vendorName,
      roleName: docusign.signerRole,
      clientUserId,
      tabs: {
        textTabs: [
          {
            tabLabel: 'EventName',
            value: event?.event_name || '',
          },
          {
            tabLabel: 'EventId',
            value: event?.event_id || '',
          },
          {
            tabLabel: 'SubmissionId',
            value: bid?.bid_id || application?.application_id || '',
          },
        ],
      },
    },
  ];

  return docusignFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      emailSubject: `RTC Event Marketplace Agreements - ${event?.event_name || event?.event_id}`,
      compositeTemplates: [
        {
          compositeTemplateId: 'governance',
          serverTemplates: [
            {
              sequence: '1',
              templateId: docusign.governanceTemplateId,
            },
          ],
          inlineTemplates: [
            {
              sequence: '2',
              recipients: { signers: templateRoles },
            },
          ],
        },
        {
          compositeTemplateId: 'nda',
          serverTemplates: [
            {
              sequence: '3',
              templateId: docusign.ndaTemplateId,
            },
          ],
          inlineTemplates: [
            {
              sequence: '4',
              recipients: { signers: templateRoles },
            },
          ],
        },
      ],
      status: 'sent',
    }),
  });
};

exports.createRecipientView = async ({
  envelopeId,
  signerName,
  signerEmail,
  vendorUserId,
  returnUrl,
}) => {
  assertTemplateSigningConfigured();
  const accessToken = await exports.getAccessToken();
  const url = `${docusign.basePath}/v2.1/accounts/${docusign.accountId}/envelopes/${envelopeId}/views/recipient`;

  return docusignFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      authenticationMethod: 'none',
      clientUserId: String(vendorUserId),
      email: signerEmail,
      userName: signerName,
      returnUrl: returnUrl || docusign.returnUrl,
    }),
  });
};

exports.getEnvelopeStatus = async (envelopeId) => {
  const accessToken = await exports.getAccessToken();
  const url = `${docusign.basePath}/v2.1/accounts/${docusign.accountId}/envelopes/${envelopeId}`;

  return docusignFetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
};

exports.downloadEnvelopeDocuments = async (envelopeId) => {
  const accessToken = await exports.getAccessToken();
  const url = `${docusign.basePath}/v2.1/accounts/${docusign.accountId}/envelopes/${envelopeId}/documents/combined`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/pdf',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `DocuSign document download failed with status ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
};

exports.mapEnvelopeStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'SIGNED';
  if (normalized === 'delivered') return 'VIEWED';
  if (normalized === 'sent') return 'SENT';
  if (normalized === 'created') return 'PENDING_SIGNATURE';
  if (normalized === 'declined') return 'DECLINED';
  if (normalized === 'voided') return 'VOIDED';
  return 'ERROR';
};
