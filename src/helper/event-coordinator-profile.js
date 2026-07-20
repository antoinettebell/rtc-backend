const EncryptionService = require('./encryption');

const normalizeTaxIdType = (value) => {
  const normalized = String(value || '').toUpperCase();
  return normalized === 'SSN' ? 'SSN' : 'EIN';
};

const taxDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 9);
const accountDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 17);

const maskTaxId = (value, type = 'EIN') => {
  const digits = taxDigits(value);
  if (!digits) return null;
  const last4 = digits.slice(-4).padStart(4, '*');
  return `${normalizeTaxIdType(type)}: *****${last4}`;
};

const maskAccountNumber = (value) => {
  const digits = accountDigits(value);
  if (!digits) return null;
  const last4 = digits.slice(-4).padStart(4, '*');
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${last4}`;
};

const buildTaxIdUpdate = ({ type, value }) => {
  const digits = taxDigits(value);
  if (!digits) return {};
  if (digits.length !== 9) {
    const error = new Error('Coordinator EIN/SSN must be 9 digits.');
    error.code = 400;
    throw error;
  }
  const taxIdType = normalizeTaxIdType(type);
  return {
    eventCoordinatorTaxIdType: taxIdType,
    eventCoordinatorTaxIdEncrypted: EncryptionService.encrypt(digits),
    eventCoordinatorTaxIdMasked: maskTaxId(digits, taxIdType),
    eventCoordinatorEin: null,
  };
};

const buildPayoutAccountUpdate = ({ value }) => {
  const digits = accountDigits(value);
  if (!digits) return {};
  if (digits.length < 4) {
    const error = new Error('Coordinator account number must include at least 4 digits.');
    error.code = 400;
    throw error;
  }
  return {
    eventCoordinatorDirectDepositAccountNumberEncrypted:
      EncryptionService.encrypt(digits),
    eventCoordinatorDirectDepositAccountNumberMasked:
      maskAccountNumber(digits),
  };
};

const sanitizeCoordinatorProfile = (user) => {
  if (!user) return user;
  const output =
    typeof user.toObject === 'function' ? user.toObject() : { ...user };
  if (!output.eventCoordinatorTaxIdMasked && output.eventCoordinatorEin) {
    output.eventCoordinatorTaxIdMasked = maskTaxId(output.eventCoordinatorEin, 'EIN');
    output.eventCoordinatorTaxIdType = output.eventCoordinatorTaxIdType || 'EIN';
  }
  if (
    !output.eventCoordinatorDirectDepositAccountNumberMasked &&
    output.eventCoordinatorDirectDepositAccountNumberEncrypted
  ) {
    const accountNumber = EncryptionService.decrypt(
      output.eventCoordinatorDirectDepositAccountNumberEncrypted
    );
    output.eventCoordinatorDirectDepositAccountNumberMasked =
      maskAccountNumber(accountNumber);
  }
  delete output.eventCoordinatorTaxIdEncrypted;
  delete output.eventCoordinatorEin;
  delete output.eventCoordinatorDirectDepositAccountNumberEncrypted;
  return output;
};

module.exports = {
  buildPayoutAccountUpdate,
  buildTaxIdUpdate,
  maskAccountNumber,
  maskTaxId,
  sanitizeCoordinatorProfile,
};
