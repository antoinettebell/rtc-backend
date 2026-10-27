const axios = require('axios');
const { aws } = require('../config');

const isOcrEnabled = () =>
  String(process.env.COMPLIANCE_OCR_ENABLED || 'false').toLowerCase() === 'true';

const enqueueComplianceOcr = async ({ document, requirement, callbackType = null }) => {
  if (!isOcrEnabled() || !process.env.COMPLIANCE_OCR_ENDPOINT) {
    return {
      ocr_status: 'not_configured',
      ocr_error_message: null,
      ocr_requested_at: null,
    };
  }

  try {
    const headers = {};
    if (process.env.COMPLIANCE_OCR_API_KEY) {
      headers.Authorization = `Bearer ${process.env.COMPLIANCE_OCR_API_KEY}`;
      headers['x-functions-key'] = process.env.COMPLIANCE_OCR_API_KEY;
    }

    await axios.post(
      process.env.COMPLIANCE_OCR_ENDPOINT,
      {
        document_id: document.document_id,
        food_truck_id: document.food_truck_id,
        vendor_user_id: document.vendor_user_id,
        document_type: document.document_type,
        file_url: document.file_url,
        file_key: document.file_key,
        mime_type: document.mime_type,
        // The signed W-9, NDA, and Governance documents all use RTC's
        // canonical S3 bucket. Send the authoritative bucket rather than
        // requiring a second compliance-specific bucket configuration.
        bucket: aws.s3Bucket,
        expected_fields: requirement?.ocrFields || [],
        ...(callbackType ? { callback_type: callbackType } : {}),
      },
      {
        timeout: Number(process.env.COMPLIANCE_OCR_TIMEOUT_MS || 60000),
        headers,
      }
    );
    return {
      ocr_status: 'queued',
      ocr_error_message: null,
      ocr_requested_at: new Date(),
    };
  } catch (error) {
    console.error('Compliance OCR enqueue failed', {
      document_id: document.document_id,
      error_name: error?.name || null,
      error_code: error?.code || null,
      http_status: error?.response?.status || null,
    });
    return {
      ocr_status: 'failed',
      ocr_error_message: 'OCR could not be started. Please try again later.',
      ocr_requested_at: new Date(),
    };
  }
};

module.exports = {
  isOcrEnabled,
  enqueueComplianceOcr,
};
