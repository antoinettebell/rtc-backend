const {
  EventVendorProfileModel,
  MarketplaceVendorBankDetailModel,
} = require('../../models');
const EncryptionService = require('../../helper/encryption');
const {
  buildBankDetailUpdate,
  hydrateLegacyWalletPaymentHandle,
} = require('../../helper/bank-detail-payment-method');
const disposableDomains = require('disposable-email-domains');

const ENCRYPTED_FIELDS = [
  'accountHolderName', 'walletPaymentHandle', 'bankName', 'accountNumber',
  'routingNumber', 'accountType', 'remittanceEmail', 'currency', 'swiftCode',
  'iban', 'paymentMethod', 'paymentQrCodeUrl', 'bankAddressLine1',
  'bankAddressLine2', 'bankCity', 'bankState', 'bankPostal',
];

const getProfile = (vendorUserId) => EventVendorProfileModel.findOne({
  vendor_user_id: vendorUserId,
  status: 'ACTIVE',
});

const profileRequiredError = () => {
  const error = new Error('Marketplace Vendor profile is required before adding payment details.');
  error.code = 404;
  return error;
};

exports.get = async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    if (!profile) throw profileRequiredError();

    const record = await MarketplaceVendorBankDetailModel.findOne({
      marketplace_vendor_profile_id: profile.profile_id,
      vendor_user_id: req.user._id,
    }).lean();

    const bankDetail = record
      ? hydrateLegacyWalletPaymentHandle(EncryptionService.decryptFields(record, ENCRYPTED_FIELDS))
      : null;
    return res.data({ bankDetail }, 'Marketplace Vendor bank detail');
  } catch (error) {
    return next(error);
  }
};

exports.save = async (req, res, next) => {
  try {
    const profile = await getProfile(req.user._id);
    if (!profile) throw profileRequiredError();

    const { remittanceEmail } = req.body;
    if (remittanceEmail) {
      const emailDomain = remittanceEmail.split('@')[1];
      if (disposableDomains.includes(emailDomain)) {
        const error = new Error('Disposable email addresses are not allowed.');
        error.code = 422;
        throw error;
      }
    }

    const mapped = buildBankDetailUpdate(req.body);
    const encrypted = EncryptionService.encryptFields(mapped, ENCRYPTED_FIELDS);
    const data = await MarketplaceVendorBankDetailModel.findOneAndUpdate(
      {
        marketplace_vendor_profile_id: profile.profile_id,
        vendor_user_id: req.user._id,
      },
      {
        $set: {
          ...encrypted,
          marketplace_vendor_profile_id: profile.profile_id,
          vendor_user_id: req.user._id,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const bankDetail = hydrateLegacyWalletPaymentHandle(
      EncryptionService.decryptFields(data.toObject(), ENCRYPTED_FIELDS),
    );
    return res.data({ bankDetail }, 'Marketplace Vendor bank detail updated');
  } catch (error) {
    return next(error);
  }
};
