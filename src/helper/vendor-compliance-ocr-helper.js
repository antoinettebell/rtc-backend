const axios = require('axios');

const isOcrEnabled = () =>
  String(process.env.COMPLIANCE_OCR_ENABLED || 'false').toLowerCase() === 'true';

const enqueueComplianceOcr = async ({ document, requirement }) => {
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

    axios.post(
      process.env.COMPLIANCE_OCR_ENDPOINT,
      {
        document_id: document.document_id,
        food_truck_id: document.food_truck_id,
        vendor_user_id: document.vendor_user_id,
        document_type: document.document_type,
        file_url: document.file_url,
        file_key: document.file_key,
        expected_fields: requirement?.ocrFields || [],
      },
      {
        timeout: Number(process.env.COMPLIANCE_OCR_TIMEOUT_MS || 15000),
        headers,
      }
    ).catch((error) => {
      console.error(
        'Compliance OCR enqueue failed:',
        document.document_id,
        error?.response?.data || error.message || error
      );
    });

    return {
      ocr_status: 'queued',
      ocr_error_message: null,
      ocr_requested_at: new Date(),
    };
  } catch (error) {
    return {
      ocr_status: 'failed',
      ocr_error_message: error.message || 'OCR request failed',
      ocr_requested_at: new Date(),
    };
  }
};

module.exports = {
  isOcrEnabled,
  enqueueComplianceOcr,
};
