const BLOCK_PATTERNS = [
  { reason: 'phone_number', pattern: /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/ },
  { reason: 'email_address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { reason: 'hyperlink', pattern: /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|co|us|biz|info|me|app|site|food|catering)\b)/i },
  { reason: 'social_handle', pattern: /(^|\s)@[a-z0-9_.-]{2,}/i },
  { reason: 'direct_contact_request', pattern: /\b(call|text|dm|message|email|whatsapp|whats\s*app|reach|contact)\s+(me|us|my|our)\b/i },
  { reason: 'direct_contact_request', pattern: /\b(find|follow|add|look\s+up)\s+(me|us)\s+on\b/i },
  { reason: 'direct_contact_request', pattern: /\b(my|our)\s+(number|phone|email|cell|mobile|handle|username|user\s*name|cash\s*app|paypal|zelle)\b/i },
  { reason: 'social_platform', pattern: /\b(insta|instagram|ig|fb|facebook|meta|twitter|x|whatsapp|whats\s*app)\b/i },
  { reason: 'payment_platform', pattern: /\b(cash\s*app|cashapp|venmo|zelle|paypal|pay\s*pal|apple\s*cash|direct\s*pay)\b/i },
  { reason: 'payment_link', pattern: /\b(pay|payment|invoice|checkout)\s*(link|url)\b/i },
  { reason: 'credit_card', pattern: /\b(?:\d[ -]*?){13,19}\b/ },
  { reason: 'ssn_ein', pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d{2}-\d{7}\b|\b(?:ssn|social security|ein|tax id)\b/i },
  { reason: 'date_of_birth', pattern: /\b(?:dob|date of birth|birthdate|born on)\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/i },
  { reason: 'exact_address', pattern: /\b\d{1,6}\s+[a-z0-9.' -]+\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|way|place|pl)\b/i },
  { reason: 'age_sex_location', pattern: /\b(age|sex|gender|male|female|location|where are you|where do you live)\b/i },
  { reason: 'body_or_blood', pattern: /\b(body|breast|butt|genital|blood|bleeding|bloody)\b/i },
];

const unique = (values = []) => [...new Set(values)];

const moderateMarketplaceText = (value) => {
  const text = String(value || '').trim();
  const reasons = BLOCK_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ reason }) => reason
  );

  return {
    status: reasons.length ? 'BLOCKED' : 'CLEAN',
    reasons: unique(reasons),
  };
};

module.exports = {
  moderateMarketplaceText,
};
