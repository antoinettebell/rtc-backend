const SUPPORT_PHONE_NUMBER = '(800) 410-7053';

const DOCUMENT_TYPES = {
  HEALTH_PERMIT: {
    type: 'HEALTH_PERMIT',
    label: 'Sanitation Grade',
    required: false,
    scoreWeight: 0,
    ocrFields: [
      'permit_number',
      'issuing_authority',
      'issue_date',
      'expiration_date',
      'sanitation_grade',
    ],
  },
  BUSINESS_LICENSE: {
    type: 'BUSINESS_LICENSE',
    label: 'Business License',
    required: true,
    scoreWeight: 0,
    ocrFields: ['license_number', 'business_name', 'issuing_authority', 'expiration_date'],
  },
  COI: {
    type: 'COI',
    label: 'Certificate of Insurance',
    required: true,
    scoreWeight: 0,
    ocrFields: [
      'policy_number',
      'insured_name',
      'carrier_name',
      'liability_limit',
      'expiration_date',
    ],
  },
  EIN: {
    type: 'EIN',
    label: 'EIN',
    required: false,
    scoreWeight: 50,
    ocrFields: ['ein', 'business_name', 'issuing_authority'],
  },
  W9: {
    type: 'W9',
    label: 'W-9',
    required: true,
    scoreWeight: 50,
    ocrFields: ['ein', 'business_name', 'tax_classification', 'signature_date'],
  },
};

const DOCUMENT_TYPE_ALIASES = {
  HEALTH: 'HEALTH_PERMIT',
  HEALTH_PERMIT: 'HEALTH_PERMIT',
  HEALTH_DEPARTMENT: 'HEALTH_PERMIT',
  PERMIT: 'HEALTH_PERMIT',
  SANITATION: 'HEALTH_PERMIT',
  SANITATION_GRADE: 'HEALTH_PERMIT',
  BUSINESS: 'BUSINESS_LICENSE',
  BUSINESS_LICENSE: 'BUSINESS_LICENSE',
  LICENSE: 'BUSINESS_LICENSE',
  COI: 'COI',
  INSURANCE: 'COI',
  CERTIFICATE_OF_INSURANCE: 'COI',
  EIN: 'EIN',
  TAX_ID: 'EIN',
  W9: 'W9',
  W_9: 'W9',
  FORM_W9: 'W9',
  FORM_W_9: 'W9',
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
const GRANDFATHER_CUTOFF_DATE = process.env.VENDOR_COMPLIANCE_GRANDFATHER_CUTOFF || '2026-08-01';

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
  GRANDFATHER_CUTOFF_DATE,
  normalizeComplianceDocumentType,
  getComplianceRequirement,
  getComplianceRequirements,
};
