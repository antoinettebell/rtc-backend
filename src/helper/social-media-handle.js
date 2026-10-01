const SOCIAL_MEDIA_KEYS = Object.freeze([
  'instagram',
  'facebook',
  'x',
  'threads',
  'tiktok',
]);

const MEDIA_TYPE_TO_KEY = Object.freeze({
  INSTAGRAM: 'instagram',
  FACEBOOK: 'facebook',
  X: 'x',
  TWITTER: 'x',
  THREADS: 'threads',
  TIKTOK: 'tiktok',
});

const HANDLE_PATTERNS = Object.freeze({
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  facebook: /^[A-Za-z0-9._-]{1,75}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
  threads: /^[A-Za-z0-9._]{1,30}$/,
  tiktok: /^[A-Za-z0-9._]{1,24}$/,
});

const extractHandleCandidate = (value, { allowLegacyUrl = false } = {}) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^(?:https?:\/\/|www\.)/i.test(raw)) {
    if (!allowLegacyUrl) return null;
    try {
      const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      return decodeURIComponent(parsed.pathname)
        .split('/')
        .filter(Boolean)
        .at(-1) || '';
    } catch (_) {
      return '';
    }
  }

  return raw;
};

const normalizeSocialMediaHandle = (value, key, options = {}) => {
  const normalizedKey = String(key || '').toLowerCase();
  if (!SOCIAL_MEDIA_KEYS.includes(normalizedKey)) {
    throw new Error('Unsupported social media platform.');
  }

  const candidate = extractHandleCandidate(value, options);
  if (candidate === '') return null;
  const normalized = String(candidate || '').replace(/^@+/, '').trim();
  if (!normalized || !HANDLE_PATTERNS[normalizedKey].test(normalized)) {
    throw new Error(`Enter a valid ${normalizedKey} handle without a link.`);
  }
  return normalized;
};

const normalizeCoordinatorSocialMedia = (value = {}) =>
  Object.fromEntries(SOCIAL_MEDIA_KEYS.map((key) => [
    key,
    normalizeSocialMediaHandle(value?.[key], key),
  ]));

const normalizeVendorSocialMedia = (value = {}) => {
  if (!Array.isArray(value)) return normalizeCoordinatorSocialMedia(value);
  const mapped = {};
  for (const entry of value) {
    const key = MEDIA_TYPE_TO_KEY[String(entry?.mediaType || '').toUpperCase()];
    if (key && mapped[key] === undefined) {
      try {
        mapped[key] = normalizeSocialMediaHandle(entry?.mediaUrl, key, { allowLegacyUrl: true });
      } catch (_) {
        // Ignore malformed legacy values; all current object payloads remain strict.
      }
    }
  }
  return normalizeCoordinatorSocialMedia(mapped);
};

module.exports = {
  SOCIAL_MEDIA_KEYS,
  normalizeCoordinatorSocialMedia,
  normalizeSocialMediaHandle,
  normalizeVendorSocialMedia,
};
