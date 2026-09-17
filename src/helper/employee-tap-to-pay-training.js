const TRAINING_VERSION = '2026.1';

const REQUIRED_ITEMS = [
  'PREBUILT_MENU_ONLY',
  'FOLLOW_ACTIVATION_INSTRUCTIONS',
  'AUTHORIZED_TO_ACCEPT_TERMS',
  'RTC_USE_ONLY',
  'ACCESS_ENDS_WITH_EMPLOYMENT',
];

const normalizeName = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();

const expectedEmployeeName = (employee) =>
  [employee?.first_name, employee?.last_name].filter(Boolean).join(' ').trim();

const getCurrentAcknowledgment = (employee, now = new Date()) => {
  const records = Array.isArray(employee?.tap_to_pay_training_acknowledgments)
    ? employee.tap_to_pay_training_acknowledgments
    : [];
  return records
    .filter(
      (record) =>
        !record.archived_at &&
        record.expires_at &&
        new Date(record.expires_at).getTime() > now.getTime()
    )
    .sort(
      (left, right) =>
        new Date(right.acknowledged_at).getTime() -
        new Date(left.acknowledged_at).getTime()
    )[0] || null;
};

const buildTrainingStatus = (employee, now = new Date()) => {
  const current = getCurrentAcknowledgment(employee, now);
  const history = (employee?.tap_to_pay_training_acknowledgments || [])
    .map((record) => {
      const value = typeof record?.toObject === 'function' ? record.toObject() : record;
      const expired = !!value?.expires_at && new Date(value.expires_at).getTime() <= now.getTime();
      const currentId = current?._id?.toString();
      const valueId = value?._id?.toString();
      return {
        ...value,
        is_current:
          current === record ||
          (!!currentId && !!valueId && currentId === valueId),
        is_archived: !!value?.archived_at || expired,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.acknowledged_at).getTime() -
        new Date(left.acknowledged_at).getTime()
    );

  return {
    version: TRAINING_VERSION,
    required_items: REQUIRED_ITEMS,
    compliant: !!current,
    score: current ? 100 : 0,
    current,
    history,
  };
};

const acknowledgeTraining = ({ employee, typedName, signedDate, checkedItems, now = new Date() }) => {
  if (normalizeName(typedName) !== normalizeName(expectedEmployeeName(employee))) {
    const error = new Error('Your typed name must match the full name on your employee profile.');
    error.code = 422;
    throw error;
  }

  const uniqueItems = [...new Set((checkedItems || []).map((item) => String(item).trim()))];
  if (
    uniqueItems.length !== REQUIRED_ITEMS.length ||
    REQUIRED_ITEMS.some((item) => !uniqueItems.includes(item))
  ) {
    const error = new Error('Acknowledge every Tap to Pay training item before signing.');
    error.code = 422;
    throw error;
  }

  const expiresAt = new Date(now);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);

  (employee.tap_to_pay_training_acknowledgments || []).forEach((record) => {
    if (!record.archived_at) record.archived_at = now;
  });
  employee.tap_to_pay_training_acknowledgments.push({
    version: TRAINING_VERSION,
    checked_items: REQUIRED_ITEMS,
    signed_name: expectedEmployeeName(employee),
    signed_date: String(signedDate || '').trim(),
    acknowledged_at: now,
    expires_at: expiresAt,
    archived_at: null,
  });

  return employee.tap_to_pay_training_acknowledgments[
    employee.tap_to_pay_training_acknowledgments.length - 1
  ];
};

module.exports = {
  TRAINING_VERSION,
  REQUIRED_ITEMS,
  buildTrainingStatus,
  acknowledgeTraining,
};
