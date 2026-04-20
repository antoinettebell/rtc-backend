const { BankDetailModel: Model } = require('../../models');
const { BaseService } = require('../../common-services');
const EncryptionService = require('../../helper/encryption');

class BankDetailService extends BaseService {
  constructor() {
    super(Model);
  }

  async updateTheDetail(userId, data) {
    // Encrypt sensitive fields
    const encryptedData = EncryptionService.encryptFields(data, [
      'accountHolderName',
      'bankName', 
      'accountNumber',
      'routingNumber',
      'accountType',
      'remittanceEmail',
      'currency',
      'swiftCode',
      'iban',
      'paymentMethod',
      'bankAddressLine1',
      'bankAddressLine2',
      'bankCity',
      'bankState',
      'bankPostal',
    ]);

    return await Model.findOneAndUpdate(
      { userId },
      { $set: { ...encryptedData, userId } },
      { new: true, upsert: true }
    );
  }

  async getByData(query, options = {}) {
    const result = await super.getByData(query, options);
    
    // Return data as-is (encrypted) for frontend consumption
    return result;
  }

  /**
   * Get bank detail by user ID
   * @param {string} userId - User ID
   * @returns {Object} - Bank detail object (encrypted)
   */
  async getByUserId(userId) {
    const result = await this.getByData(
      { userId },
      { singleResult: true, lean: true }
    );
    
    // If no bank detail exists, return null
    if (!result) {
      return null;
    }
    
    return result;
  }
}

module.exports = new BankDetailService();
