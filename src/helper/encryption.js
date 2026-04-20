const cryptLib = require('cryptlib');
const { encryption } = require('../config');

/**
 * Encryption service for sensitive data using cryptlib (AES-256-CBC)
 */
class EncryptionService {
  constructor() {
    this.secretKey = encryption.secretKey;
  }

  /**
   * Encrypt data
   * @param {string} data - Data to encrypt
   * @returns {string} - Encrypted data
   */
  encrypt(data) {
    if (!data) return null;

    // cryptlib expects: key (32 bytes), iv (16 bytes string)
    const iv = cryptLib.generateRandomIV(16);
    const key = cryptLib.getHashSha256(this.secretKey, 32);
    const cipherText = cryptLib.encrypt(data, key, iv);

    // Persist as iv:cipher format
    return `${iv}:${cipherText}`;
  }

  /**
   * Decrypt data
   * @param {string} encryptedData - Encrypted data to decrypt
   * @returns {string} - Decrypted data
   */
  decrypt(encryptedData) {
    if (!encryptedData) return null;
    
    // Check if data is already in plain text (not encrypted)
    if (!encryptedData.includes(':')) {
      return encryptedData;
    }
    
    try {
      const textParts = encryptedData.split(':');
      if (textParts.length < 2) {
        return encryptedData; // Return as-is if not in expected format
      }

      const iv = textParts[0];
      const cipherText = textParts.slice(1).join(':');
      const key = cryptLib.getHashSha256(this.secretKey, 32);
      const plainText = cryptLib.decrypt(cipherText, key, iv);

      return plainText;
    } catch (error) {
      console.error('Decryption error:', error);
      // Return original data if decryption fails (for backward compatibility)
      return encryptedData;
    }
  }

  /**
   * Encrypt object fields
   * @param {Object} data - Object with fields to encrypt
   * @param {Array} fields - Array of field names to encrypt
   * @returns {Object} - Object with encrypted fields
   */
  encryptFields(data, fields) {
    const encryptedData = { ...data };
    
    fields.forEach(field => {
      if (encryptedData[field]) {
        encryptedData[field] = this.encrypt(encryptedData[field]);
      }
    });
    
    return encryptedData;
  }

  /**
   * Decrypt object fields
   * @param {Object} data - Object with fields to decrypt
   * @param {Array} fields - Array of field names to decrypt
   * @returns {Object} - Object with decrypted fields
   */
  decryptFields(data, fields) {
    const decryptedData = { ...data };
    
    fields.forEach(field => {
      if (decryptedData[field]) {
        decryptedData[field] = this.decrypt(decryptedData[field]);
      }
    });
    
    return decryptedData;
  }
}

module.exports = new EncryptionService(); 