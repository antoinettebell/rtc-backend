const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const getSafeErrorCode = (error) => {
  const value = error?.code || error?.statusCode || error?.status;
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().slice(0, 80) || null;
};

const buildIntegrationAlertEmail = ({ subject, error, occurredAt = new Date() }) => {
  const safeSubject = escapeHtml(subject || 'Integration error');
  const safeErrorCode = getSafeErrorCode(error);
  const timestamp = occurredAt instanceof Date
    ? occurredAt.toISOString()
    : new Date(occurredAt).toISOString();

  return [
    `<p><strong>${safeSubject}</strong></p>`,
    '<p>An external integration request did not complete. Review the secured server logs for diagnostic details.</p>',
    `<p><strong>Occurred:</strong> ${escapeHtml(timestamp)}</p>`,
    ...(safeErrorCode
      ? [`<p><strong>Error code:</strong> ${escapeHtml(safeErrorCode)}</p>`]
      : []),
  ].join('');
};

module.exports = {
  buildIntegrationAlertEmail,
  getSafeErrorCode,
};
