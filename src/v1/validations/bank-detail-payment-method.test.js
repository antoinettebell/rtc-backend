const assert = require('assert');
const UserValidation = require('./user-validation');
const {
  buildBankDetailUpdate,
  hydrateLegacyWalletPaymentHandle,
} = require('../../helper/bank-detail-payment-method');

const bankValues = {
  accountHolderName: 'Vendor Name',
  bankName: 'Bank',
  accountNumber: '12345678',
  routingNumber: '123456789',
  accountType: 'CHECKING',
  bankAddressLine1: '1 Main St',
  bankCity: 'Newark',
  bankState: 'NJ',
  bankPostal: '07106',
};
const walletValues = {
  walletPaymentHandle: '$truck',
  remittanceEmail: 'pay@example.com',
  currency: 'USD',
  paymentQrCodeUrl: 'https://example.com/qr.png',
};

const validate = (body) => UserValidation.bankDetail.body.validate(body);

['CASHAPP', 'PAYPAL', 'VENMO'].forEach((paymentMethod) => {
  assert.equal(validate({ paymentMethod, ...walletValues }).error, undefined);
  assert.ok(validate({ paymentMethod, ...walletValues, remittanceEmail: '' }).error);
  assert.ok(validate({ paymentMethod, ...walletValues, currency: '' }).error);
  assert.ok(validate({
    paymentMethod,
    ...walletValues,
    walletPaymentHandle: '',
    accountHolderName: '',
  }).error);
});

['ACH', 'CHECK'].forEach((paymentMethod) => {
  assert.equal(validate({ paymentMethod, ...bankValues }).error, undefined);
  assert.equal(validate({
    paymentMethod,
    ...bankValues,
    swiftCode: 'BOFAUS3N',
    iban: 'GB82WEST12345698765432',
  }).error, undefined);
  assert.equal(
    validate({ paymentMethod, ...bankValues, remittanceEmail: '', currency: '' })
      .error,
    undefined,
  );
  assert.ok(validate({ paymentMethod, accountHolderName: 'Vendor Name' }).error);
});
assert.ok(validate({ paymentMethod: 'ACH', ...bankValues, swiftCode: 'bad' }).error);
assert.ok(validate({ paymentMethod: 'CHECK', ...bankValues, iban: 'bad' }).error);

const allValues = { ...bankValues, ...walletValues };
const walletUpdate = buildBankDetailUpdate({
  ...allValues,
  paymentMethod: 'VENMO',
});
assert.equal(walletUpdate.remittanceEmail, walletValues.remittanceEmail);
assert.equal(walletUpdate.walletPaymentHandle, '$truck');
assert.equal('accountHolderName' in walletUpdate, false);
assert.equal('bankName' in walletUpdate, false);
const bankUpdate = buildBankDetailUpdate({
  ...allValues,
  paymentMethod: 'ACH',
  swiftCode: 'BOFAUS3N',
  iban: 'GB82WEST12345698765432',
});
assert.equal(bankUpdate.bankName, bankValues.bankName);
assert.equal(bankUpdate.accountHolderName, bankValues.accountHolderName);
assert.equal(bankUpdate.swiftCode, 'BOFAUS3N');
assert.equal(bankUpdate.iban, 'GB82WEST12345698765432');
assert.equal('remittanceEmail' in bankUpdate, false);
assert.deepEqual(
  hydrateLegacyWalletPaymentHandle({
    paymentMethod: 'PAYPAL',
    accountHolderName: 'legacy@example.com',
  }).walletPaymentHandle,
  'legacy@example.com',
);

console.log('bank detail payment-method validation tests passed');
