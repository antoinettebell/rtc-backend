const SUPPORT_PHONE_NUMBER = '(800) 410-7053';

const DOCUMENT_TYPES = {
  HEALTH_PERMIT: {
    type: 'HEALTH_PERMIT',
    label: 'Health Permit',
    required: true,
    scoreWeight: 34,
    ocrFields: ['permit_number', 'issuing_authority', 'issue_date', 'expiration_date'],
  },
  BUSINESS_LICENSE: {
    type: 'BUSINESS_LICENSE',
    label: 'Business License',
    required: true,
    scoreWeight: 33,
    ocrFields: ['license_number', 'business_name', 'issuing_authority', 'expiration_date'],
  },
  COI: {
    type: 'COI',
    label: 'Certificate of Insurance',
    required: true,
    scoreWeight: 33,
    ocrFields: [
      'policy_number',
      'insured_name',
      'carrier_name',
      'liability_limit',
      'expiration_date',
    ],
  },
};

const DOCUMENT_TYPE_ALIASES = {
  HEALTH: 'HEALTH_PERMIT',
  HEALTH_PERMIT: 'HEALTH_PERMIT',
  PERMIT: 'HEALTH_PERMIT',
  BUSINESS: 'BUSINESS_LICENSE',
  BUSINESS_LICENSE: 'BUSINESS_LICENSE',
  LICENSE: 'BUSINESS_LICENSE',
  COI: 'COI',
  INSURANCE: 'COI',
  CERTIFICATE_OF_INSURANCE: 'COI',
};

const OCR_STATUSES = [
  'not_configured',
  'queued',
  'processing',
  'completed',
  'failed',
  'manual_review',
];

const REVIEW_STATUSES = [
  'pending_review',
  'verified',
  'rejected',
  'expired',
  'archived',
];

const REMINDER_DAYS = [90, 60, 30, 10];

const normalizeComplianceDocumentType = (value = '') => {
  const key = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return DOCUMENT_TYPE_ALIASES[key] || key;
};

const getComplianceRequirement = (type) =>
  DOCUMENT_TYPES[normalizeComplianceDocumentType(type)] || null;

const getComplianceRequirements = () => Object.values(DOCUMENT_TYPES);

module.exports = {
  SUPPORT_PHONE_NUMBER,
  DOCUMENT_TYPES,
  OCR_STATUSES,
  REVIEW_STATUSES,
  REMINDER_DAYS,
  normalizeComplianceDocumentType,
  getComplianceRequirement,
  getComplianceRequirements,
};
