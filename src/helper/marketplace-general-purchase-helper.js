const MAX_TAX_RATE = 25;
const MAX_ITEMS = 50;

const money = (value) => Number((Math.round((Number(value) || 0) * 100) / 100).toFixed(2));

const buildGeneralPurchaseTotals = ({ items, taxRate }) => {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    throw Object.assign(new Error(`Enter between 1 and ${MAX_ITEMS} purchase items.`), { code: 400 });
  }

  const normalizedItems = items.map((item, index) => {
    const description = String(item?.description || '').trim();
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unit_price ?? item?.unitPrice);
    if (!description) {
      throw Object.assign(new Error(`Item ${index + 1} requires a description.`), { code: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw Object.assign(new Error(`Item ${index + 1} quantity must be greater than zero.`), { code: 400 });
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw Object.assign(new Error(`Item ${index + 1} price must be zero or greater.`), { code: 400 });
    }
    return {
      description: description.slice(0, 200),
      quantity,
      unit_price: money(unitPrice),
      line_total: money(quantity * unitPrice),
    };
  });

  const normalizedTaxRate = Number(taxRate || 0);
  if (!Number.isFinite(normalizedTaxRate) || normalizedTaxRate < 0 || normalizedTaxRate > MAX_TAX_RATE) {
    throw Object.assign(new Error(`Sales tax must be between 0 and ${MAX_TAX_RATE} percent.`), { code: 400 });
  }
  const subtotal = money(normalizedItems.reduce((sum, item) => sum + item.line_total, 0));
  const taxAmount = money(subtotal * (normalizedTaxRate / 100));
  return {
    items: normalizedItems,
    subtotal,
    tax_rate: money(normalizedTaxRate),
    tax_amount: taxAmount,
    total: money(subtotal + taxAmount),
  };
};

const buildGeneralPurchaseRefundRequest = (purchase) => ({
  transactionId: purchase.transaction_id,
  amount: purchase.total,
  paymentMethod: 'TAP_TO_PAY',
});

module.exports = { MAX_ITEMS, MAX_TAX_RATE, buildGeneralPurchaseTotals, buildGeneralPurchaseRefundRequest, money };
