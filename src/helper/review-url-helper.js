const validatePublicReviewUrl = (
  configuredUrl = process.env.PUBLIC_REVIEW_URL
) => {
  const baseUrl = String(configuredUrl || '').replace(/\/+$/, '');
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'https:' ||
      ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    ) {
      return null;
    }
    return url;
  } catch (error) {
    return null;
  }
};

const buildPublicReviewUrl = (reviewToken, configuredUrl) => {
  if (!reviewToken) return null;
  const url = validatePublicReviewUrl(configuredUrl);
  if (!url) return null;
  url.pathname = `${url.pathname.replace(/\/$/, '')}/review`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('token', reviewToken);
  return url.toString();
};

module.exports = { buildPublicReviewUrl, validatePublicReviewUrl };
