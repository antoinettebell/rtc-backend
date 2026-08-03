const assert = require('assert');
const axios = require('axios');

let capturedRequest;
const originalPost = axios.post;
axios.post = async (url, payload, options) => {
  capturedRequest = { url, payload, options };
  return { data: { totalTax: 4.25, code: payload.code } };
};

const TaxHelper = require('./tax-helper');

(async () => {
  try {
    const result = await TaxHelper.calculateEventTicketTax({
      shipFrom: { line1: '1 Event Way', city: 'Atlanta', region: 'GA', postalCode: '30303', country: 'US' },
      shipTo: { line1: '2 Buyer Way', city: 'Atlanta', region: 'GA', postalCode: '30303', country: 'US' },
      ticketAmount: 100,
      serviceFee: 3.5,
      admissionsTaxCode: 'OA020200',
      merchantSellerIdentifier: 'coordinator-1',
      customerCode: 'buyer-1',
      transactionCode: 'RTC-TICKET-TEST-1',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.totalTax, 4.25);
    assert.strictEqual(capturedRequest.payload.type, 'SalesInvoice');
    assert.strictEqual(capturedRequest.payload.marketplaceLiabilityType, 'Marketplace');
    assert.strictEqual(capturedRequest.payload.merchantSellerIdentifier, 'coordinator-1');
    assert.deepStrictEqual(
      capturedRequest.payload.lines.map(({ itemCode, taxCode, amount }) => ({ itemCode, taxCode, amount })),
      [
        { itemCode: 'EVENT_TICKET', taxCode: 'OA020200', amount: 100 },
        { itemCode: 'PLATFORM_SERVICE_FEE', taxCode: 'SW054003', amount: 3.5 },
      ]
    );
    assert.ok(capturedRequest.payload.addresses.shipFrom);
    assert.ok(capturedRequest.payload.addresses.shipTo);
    assert.ok(capturedRequest.options.headers['X-Avalara-Client']);
    console.log('event ticket tax helper tests passed');
  } finally {
    axios.post = originalPost;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
