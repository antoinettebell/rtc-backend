const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
const originalFetch = global.fetch;
const requests = [];

const docusign = {
  accountId: 'account-1',
  basePath: 'https://demo.docusign.test/restapi',
  governanceTemplateId: 'governance-template',
  governanceVersion: '1',
  ndaTemplateId: 'nda-template',
  ndaVersion: '1',
  signerRole: 'VendorSigner',
  returnUrl: 'rtc-vendor://marketplace-agreement-return',
  integrationKey: 'integration-key',
  userId: 'user-1',
  privateKey: 'unused',
  authServer: 'account-d.docusign.com',
};

const jsonResponse = (body) => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

Module._load = function load(request, parent, isMain) {
  if (request === '../config' && parent?.filename?.endsWith('/helper/docusign-helper.js')) {
    return { docusign };
  }
  return originalLoad.call(this, request, parent, isMain);
};

global.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  if (url.includes('/templates/governance-template/recipients')) {
    return jsonResponse({
      signers: [{
        roleName: 'GovernanceSigner',
        tabs: { signHereTabs: [{ documentId: '1' }] },
      }],
    });
  }
  if (url.includes('/templates/nda-template/recipients')) {
    return jsonResponse({
      signers: [{
        roleName: 'NdaSigner',
        tabs: { signHereTabs: [{ documentId: '1' }] },
      }],
    });
  }
  if (url.endsWith('/envelopes') && options.method === 'POST') {
    return jsonResponse({ envelopeId: 'envelope-1', status: 'sent' });
  }
  if (url.includes('/envelopes/envelope-1/recipients')) {
    return jsonResponse({
      signers: [{
        clientUserId: 'vendor-1',
        tabs: { signHereTabs: [{ documentId: '1' }, { documentId: '2' }] },
      }],
    });
  }
  if (url.endsWith('/envelopes/envelope-1/views/recipient') && options.method === 'POST') {
    return jsonResponse({ url: 'https://demo.docusign.test/sign-second' });
  }
  throw new Error(`Unexpected DocuSign request: ${options.method || 'GET'} ${url}`);
};

(async () => {
  try {
    const helper = require('./docusign-helper');
    helper.getAccessToken = async () => 'access-token';

    const envelope = await helper.createVendorMarketplaceSigningEnvelope({
      vendorName: 'Vendor Owner',
      vendorEmail: 'vendor@example.com',
      vendorUserId: 'vendor-1',
      event: { event_id: 'event-1', event_name: 'Test Event' },
    });
    assert.equal(envelope.envelopeId, 'envelope-1');

    const creationRequest = requests.find(
      ({ url, options }) => url.endsWith('/envelopes') && options.method === 'POST'
    );
    const payload = JSON.parse(creationRequest.options.body);
    assert.equal(
      payload.compositeTemplates[0].inlineTemplates[0].recipients.signers[0].roleName,
      'GovernanceSigner'
    );
    assert.equal(
      payload.compositeTemplates[1].inlineTemplates[0].recipients.signers[0].roleName,
      'NdaSigner'
    );
    assert(
      requests.some(({ url }) =>
        url.endsWith('/templates/governance-template/recipients?include_tabs=true'))
    );
    assert(
      requests.some(({ url }) =>
        url.endsWith('/templates/nda-template/recipients?include_tabs=true'))
    );

    const recipients = await helper.getEnvelopeRecipients('envelope-1');
    assert.equal(
      helper.inspectMarketplaceAgreementSignatures(recipients, 'vendor-1').valid,
      true
    );
    assert(
      requests.some(({ url }) =>
        url.endsWith('/envelopes/envelope-1/recipients?include_tabs=true'))
    );

    const view = await helper.createRecipientView({
      envelopeId: 'envelope-1',
      signerName: 'Vendor Owner',
      signerEmail: 'vendor@example.com',
      vendorUserId: 'vendor-1',
      clientUserId: 'vendor-1',
      recipientId: '2',
      returnUrl: 'rounddacornervendor://docusign/return?status=completed',
    });
    assert.equal(view.url, 'https://demo.docusign.test/sign-second');
    const recipientViewRequest = requests.find(
      ({ url, options }) => url.endsWith('/views/recipient') && options.method === 'POST'
    );
    assert.equal(JSON.parse(recipientViewRequest.options.body).recipientId, '2');

    console.log('DocuSign helper vendor signing tests passed');
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
