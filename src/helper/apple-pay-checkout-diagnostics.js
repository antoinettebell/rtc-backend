const valueType = (value) => {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
};

const valuePresent = (value) => {
  if (value === undefined || value === null) return false;
  return typeof value !== 'string' || value.trim().length > 0;
};

const isApplePayCheckout = (body = {}) =>
  String(body?.paymentMethod || 'APPLE_PAY').toUpperCase() === 'APPLE_PAY';

// Deliberately returns metadata only. Never add payment-token values here.
const getApplePayCheckoutRequestShape = (body = {}) => ({
  field_names:
    body && typeof body === 'object' && !Array.isArray(body)
      ? Object.keys(body).sort()
      : [],
  payment_method: {
    type: valueType(body?.paymentMethod),
    present: valuePresent(body?.paymentMethod),
  },
  payment_data: {
    type: valueType(body?.paymentData),
    present: valuePresent(body?.paymentData),
  },
  amount: {
    type: valueType(body?.amount),
    present: valuePresent(body?.amount),
  },
  tax_amount: {
    type: valueType(body?.taxAmount),
    present: valuePresent(body?.taxAmount),
  },
  subtotal: {
    type: valueType(body?.subTotal),
    present: valuePresent(body?.subTotal),
  },
  legacy_apple_pay_token: {
    type: valueType(body?.applePayToken),
    present: valuePresent(body?.applePayToken),
  },
});

module.exports = {
  getApplePayCheckoutRequestShape,
  isApplePayCheckout,
};
