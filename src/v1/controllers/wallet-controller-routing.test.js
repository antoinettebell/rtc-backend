const assert = require('assert');
const fs = require('fs');
const path = require('path');

[
  ['order-controller.js', 'exports.paymentCheckout'],
  ['marketplace-controller.js', 'exports.checkoutPayment'],
  ['marketplace-ticket-controller.js', 'exports.checkout'],
].forEach(([file, exportName]) => {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert(source.includes(exportName), `${file} must retain its checkout route`);
  assert(source.includes('CyberSourceGooglePayHelper.chargeGooglePay'), `${file} must route Google Pay to CyberSource`);
  assert(source.includes('CyberSourceApplePayHelper.chargeApplePay'), `${file} must retain Apple Pay on CyberSource`);
  assert(!source.includes("require('../../helper/payment-helper')"), `${file} must not load Authorize.net payment processing`);
});

console.log('wallet controller routing tests passed');
