const ACTIVATION_STATUSES = new Set(['UNKNOWN', 'PENDING', 'SUCCEEDED', 'FAILED']);

const normalizeActivationStatus = (value) => {
  const normalized = String(value || 'UNKNOWN').trim().toUpperCase();
  return ACTIVATION_STATUSES.has(normalized) ? normalized : 'UNKNOWN';
};

const resolveMarketplaceTerminalState = ({
  activationStatus,
  existingStatus,
  existingActivationStatus,
} = {}) => {
  const normalizedActivationStatus = normalizeActivationStatus(activationStatus);
  const normalizedExistingActivationStatus = normalizeActivationStatus(
    existingActivationStatus
  );

  if (normalizedActivationStatus === 'SUCCEEDED') {
    return {
      status: 'ACTIVE',
      activationStatus: 'SUCCEEDED',
      activated: true,
    };
  }

  if (
    existingStatus === 'ACTIVE' &&
    normalizedExistingActivationStatus === 'SUCCEEDED' &&
    normalizedActivationStatus === 'UNKNOWN'
  ) {
    return {
      status: 'ACTIVE',
      activationStatus: 'SUCCEEDED',
      activated: true,
    };
  }

  return {
    status: existingStatus === 'HISTORICAL' ? 'HISTORICAL' : 'PENDING_ACTIVATION',
    activationStatus:
      normalizedActivationStatus === 'UNKNOWN'
        ? normalizedExistingActivationStatus
        : normalizedActivationStatus,
    activated: false,
  };
};

module.exports = {
  normalizeActivationStatus,
  resolveMarketplaceTerminalState,
};
