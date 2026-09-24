const assert = require('assert');
const { buildGeneralPurchaseTotals, buildGeneralPurchaseRefundRequest } = require('./marketplace-general-purchase-helper');

const result = buildGeneralPurchaseTotals({
  items: [
    { description: 'Handmade candle', quantity: 2, unit_price: 12.5 },
    { description: 'Gift wrap', quantity: 1, unit_price: 2 },
  ],
  taxRate: 7.25,
});
assert.deepStrictEqual(result, {
  items: [
    { description: 'Handmade candle', quantity: 2, unit_price: 12.5, line_total: 25 },
    { description: 'Gift wrap', quantity: 1, unit_price: 2, line_total: 2 },
  ],
  subtotal: 27,
  tax_rate: 7.25,
  tax_amount: 1.96,
  total: 28.96,
});
assert.throws(() => buildGeneralPurchaseTotals({ items: [], taxRate: 0 }), /between 1 and 50/);
assert.throws(() => buildGeneralPurchaseTotals({ items: [{ description: '', quantity: 1, unit_price: 1 }], taxRate: 0 }), /description/);
assert.throws(() => buildGeneralPurchaseTotals({ items: [{ description: 'Item', quantity: 0, unit_price: 1 }], taxRate: 0 }), /quantity/);
assert.throws(() => buildGeneralPurchaseTotals({ items: [{ description: 'Item', quantity: 1, unit_price: -1 }], taxRate: 0 }), /price/);
assert.throws(() => buildGeneralPurchaseTotals({ items: [{ description: 'Item', quantity: 1, unit_price: 1 }], taxRate: 26 }), /between 0 and 25/);
assert.deepStrictEqual(buildGeneralPurchaseRefundRequest({ transaction_id: 'txn-1', total: 12.34 }), {
  transactionId: 'txn-1',
  amount: 12.34,
  paymentMethod: 'TAP_TO_PAY',
});
console.log('Marketplace General Purchase helper tests passed.');
