const {
  TapToPayTerminalModel,
  TapToPayTerminalEventModel,
  VendorEmployeeModel,
} = require('../../models');

const safeText = (value, max = 500) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (['token', 'secret', 'authorization', 'cryptogram', 'card number', 'account number'].some((marker) => lowered.includes(marker))) {
    return '[redacted]';
  }
  return text.slice(0, max);
};

const normalizeEnvironment = (value) =>
  ['test', 'sandbox'].includes(String(value || '').toLowerCase()) ? 'TEST' : 'PRODUCTION';

const actorDetails = ({ user, employee, foodTruck }) => ({
  assigned_user_type: user.userType === 'EMPLOYEE' ? 'EMPLOYEE' : 'VENDOR',
  assigned_user_id: employee?._id || user._id,
  employee_internal_id: employee?.employee_internal_id || null,
  vendor_user_id: foodTruck.userId,
});

const register = async ({ user, employee, foodTruck, body }) => {
  const deviceId = String(body.device_id || '').trim();
  const now = new Date();
  const existing = await TapToPayTerminalModel.findOne({
    food_truck_id: foodTruck._id,
    device_id: deviceId,
  });
  const wasReactivationRequired = existing?.reactivation_required === true;
  const details = actorDetails({ user, employee, foodTruck });
  const update = {
    ...details,
    device_id_suffix: deviceId.slice(-4),
    device_label: safeText(body.device_label, 120) || existing?.device_label || 'iPhone',
    environment: normalizeEnvironment(body.environment),
    status: body.activation_status === 'SUCCEEDED'
      ? 'ACTIVE'
      : (existing?.status || 'ACTIVE'),
    last_seen_at: now,
    last_activation_status: body.activation_status === 'SUCCEEDED' ? 'SUCCEEDED' : (existing?.last_activation_status || 'UNKNOWN'),
  };
  if (body.activation_status === 'SUCCEEDED') {
    update.last_activation_at = now;
    update.last_activation_error_code = null;
    update.last_activation_error_message = null;
    update.reactivation_required = false;
    update.reactivation_reason = null;
    if (wasReactivationRequired) update.reactivation_completed_at = now;
  }

  const historyEntries = [];
  if (!existing) {
    historyEntries.push({ action: 'REGISTERED', actor_type: user.userType, actor_id: user._id, occurred_at: now });
  }
  if (wasReactivationRequired && body.activation_status === 'SUCCEEDED') {
    historyEntries.push({ action: 'REACTIVATION_COMPLETED', actor_type: user.userType, actor_id: user._id, occurred_at: now });
  }
  if (existing && (
    existing.assigned_user_type !== details.assigned_user_type
    || String(existing.assigned_user_id) !== String(details.assigned_user_id)
  )) {
    historyEntries.push({ action: 'ASSIGNMENT_CHANGED', actor_type: user.userType, actor_id: user._id, occurred_at: now });
  }
  const terminal = await TapToPayTerminalModel.findOneAndUpdate(
    { food_truck_id: foodTruck._id, device_id: deviceId },
    {
      $set: update,
      $setOnInsert: {
        registered_at: now,
      },
      ...(historyEntries.length ? { $push: { history: { $each: historyEntries } } } : {}),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return terminal;
};

const status = async ({ foodTruck, deviceId }) => {
  const terminal = await TapToPayTerminalModel.findOne({
    food_truck_id: foodTruck._id,
    device_id: deviceId,
  });
  if (!terminal) return { known: false, status: 'UNREGISTERED', reactivation_required: false };
  terminal.last_seen_at = new Date();
  await terminal.save();
  return {
    known: true,
    terminal_id: terminal._id,
    status: terminal.status,
    reactivation_required: terminal.reactivation_required,
    reactivation_reason: terminal.reactivation_reason,
    device_id_suffix: terminal.device_id_suffix,
  };
};

const recordEvent = async ({ user, foodTruck, body }) => {
  const deviceId = String(body.device_id || '').trim();
  const terminal = deviceId
    ? await TapToPayTerminalModel.findOne({ food_truck_id: foodTruck._id, device_id: deviceId })
    : null;
  const now = new Date();
  const event = await TapToPayTerminalEventModel.create({
    food_truck_id: foodTruck._id,
    terminal_id: terminal?._id || null,
    actor_type: user.userType,
    actor_id: user._id,
    event_type: body.event_type,
    environment: normalizeEnvironment(body.environment),
    device_id_suffix: deviceId ? deviceId.slice(-4) : null,
    device_label: safeText(body.device_label, 120),
    error_code: safeText(body.error_code, 120),
    error_message: safeText(body.error_message, 500),
    occurred_at: now,
  });
  if (terminal && body.event_type.startsWith('ACTIVATION_')) {
    const activationStatus = body.event_type === 'ACTIVATION_STARTED'
      ? 'PENDING'
      : body.event_type.replace('ACTIVATION_', '');
    terminal.last_activation_status = activationStatus;
    terminal.last_activation_at = now;
    terminal.activation_attempt_count = (terminal.activation_attempt_count || 0) + (activationStatus === 'PENDING' ? 1 : 0);
    terminal.last_activation_error_code = activationStatus === 'FAILED' ? safeText(body.error_code, 120) : null;
    terminal.last_activation_error_message = activationStatus === 'FAILED' ? safeText(body.error_message, 500) : null;
    await terminal.save();
  }
  return event;
};

const importLegacy = async (foodTruck) => {
  const importOne = async ({ deviceId, user, employee, deviceLabel }) => {
    const normalizedId = String(deviceId || '').trim();
    if (!normalizedId) return;
    const existing = await TapToPayTerminalModel.findOne({
      food_truck_id: foodTruck._id,
      device_id: normalizedId,
    });
    if (existing) return;
    const now = new Date();
    const details = actorDetails({ user, employee, foodTruck });
    try {
      await TapToPayTerminalModel.create({
        food_truck_id: foodTruck._id,
        ...details,
        device_id: normalizedId,
        device_id_suffix: normalizedId.slice(-4),
        device_label: deviceLabel,
        registered_at: now,
        last_seen_at: now,
        history: [{
          action: 'LEGACY_IMPORTED',
          actor_type: 'SUPER_ADMIN',
          reason: 'Imported from the prior single-terminal profile field',
          occurred_at: now,
        }],
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  };
  const imports = [];
  if (foodTruck.tap_to_pay_serial_number) {
    imports.push(importOne({
      deviceId: foodTruck.tap_to_pay_serial_number,
      user: { _id: foodTruck.userId, userType: 'VENDOR' },
      deviceLabel: 'Legacy vendor iPhone',
    }));
  }
  const employees = await VendorEmployeeModel.find({
    food_truck_id: foodTruck._id,
    tap_to_pay_serial_number: { $nin: [null, ''] },
  });
  employees.forEach((employee) => imports.push(importOne({
    deviceId: employee.tap_to_pay_serial_number,
    user: { _id: employee._id, userType: 'EMPLOYEE' },
    employee,
    deviceLabel: `Employee ${employee.first_name || ''} ${employee.last_name || ''}`.trim(),
  })));
  await Promise.all(imports);
};

const listForAdmin = async (foodTruck) => {
  await importLegacy(foodTruck);
  const [terminals, events] = await Promise.all([
    TapToPayTerminalModel.find({ food_truck_id: foodTruck._id }).sort({ last_seen_at: -1 }).lean(),
    TapToPayTerminalEventModel.find({ food_truck_id: foodTruck._id }).sort({ occurred_at: -1 }).limit(50).lean(),
  ]);
  return { terminals, events };
};

const adminAdd = async ({ foodTruck, user, body }) => {
  const deviceId = String(body.device_id || '').trim();
  const existing = await TapToPayTerminalModel.findOne({
    food_truck_id: foodTruck._id,
    device_id: deviceId,
  });
  if (existing) return { duplicate: true, terminal: existing };

  const now = new Date();
  const terminal = await TapToPayTerminalModel.create({
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    assigned_user_type: 'VENDOR',
    assigned_user_id: foodTruck.userId,
    device_id: deviceId,
    device_id_suffix: deviceId.slice(-4),
    device_label: safeText(body.device_label, 120) || 'Manually added iPhone',
    environment: normalizeEnvironment(body.environment),
    status: body.status === 'HISTORICAL' ? 'HISTORICAL' : 'ACTIVE',
    registered_at: now,
    last_seen_at: null,
    history: [{
      action: 'MANUALLY_ADDED',
      actor_type: user.userType,
      actor_id: user._id,
      reason: safeText(body.reason, 500) || 'Backfilled from CyberSource Acceptance Devices',
      occurred_at: now,
    }],
  });

  if (terminal.status === 'ACTIVE') {
    foodTruck.tap_to_pay_serial_number = deviceId;
    await foodTruck.save();
  }
  return { duplicate: false, terminal };
};

const adminUpdate = async ({ foodTruck, terminalId, user, body }) => {
  const terminal = await TapToPayTerminalModel.findOne({ _id: terminalId, food_truck_id: foodTruck._id });
  if (!terminal) return null;
  const now = new Date();
  const reason = safeText(body.reason, 500);
  if (body.action === 'REQUIRE_REACTIVATION') {
    terminal.reactivation_required = true;
    terminal.reactivation_requested_at = now;
    terminal.reactivation_requested_by = user._id;
    terminal.reactivation_reason = reason || 'Requested by RTC support';
  } else if (body.action === 'MARK_HISTORICAL') {
    terminal.status = 'HISTORICAL';
  } else if (body.action === 'RESTORE_ACTIVE') {
    terminal.status = 'ACTIVE';
  } else if (body.action === 'CLEAR_REACTIVATION') {
    terminal.reactivation_required = false;
    terminal.reactivation_reason = null;
  }
  if (body.device_label !== undefined) terminal.device_label = safeText(body.device_label, 120) || 'iPhone';
  terminal.history.push({ action: body.action, actor_type: user.userType, actor_id: user._id, reason, occurred_at: now });
  await terminal.save();
  return terminal;
};

module.exports = { register, status, recordEvent, listForAdmin, adminAdd, adminUpdate, safeText, normalizeEnvironment };
