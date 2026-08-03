const crypto = require('crypto');

const TOKEN_BYTES = 32;

const hashTicketToken = (token) =>
  crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');

const createTicketToken = () => {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashTicketToken(token) };
};

const buildPublicTicketUrl = (baseUrl, token) => {
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(normalizedBaseUrl)) {
    throw new Error('Public ticket base URL must use HTTPS');
  }
  if (!token) throw new Error('Ticket token is required');
  return `${normalizedBaseUrl}/t/${encodeURIComponent(token)}`;
};

module.exports = { TOKEN_BYTES, hashTicketToken, createTicketToken, buildPublicTicketUrl };
