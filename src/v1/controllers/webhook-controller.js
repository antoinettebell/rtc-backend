const crypto = require('crypto');
const { docusign } = require('../../config');
const { FoodTruckModel, UserModel, VendorEmployeeModel, EmployeeSessionModel } = require('../../models');
const CustomNotification = require('../../helper/custom-notification');
const VendorComplianceService = require('../services/vendor-compliance-service');
const EmployeeSessionService = require('../services/employee-session-service');
const {
  DEFAULT_VENDOR_SCHEDULE_TIME_ZONE,
  applyVendorScheduleTimeZoneCache,
} = require('../../helper/vendor-schedule-timezone');
const {
  getEmployeeScheduleState,
  getEmployeeScheduleAssignment,
} = require('../../helper/employee-weekly-schedule');

const WEEKLY_SCHEDULE_OPEN_BUFFER_MINUTES = 0;
const WEEKLY_SCHEDULE_CLOSE_BUFFER_MINUTES = 0;
const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const acceptedStatuses = new Set([
  'completed',
  'declined',
  'voided',
  'delivery_failed',
  'failed',
]);

const statusAliases = {
  'envelope-completed': 'completed',
  'envelope-declined': 'declined',
  'envelope-voided': 'voided',
  'envelope-delivery-failed': 'delivery_failed',
  'recipient-delivery-failed': 'delivery_failed',
};

const getHeader = (headers, name) =>
  headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];

const parseBody = (body) => {
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString('utf8') || '{}');
  }
  return body || {};
};

const safeCompare = (left, right) => {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const verifySignature = ({ rawBody, headers }) => {
  if (!docusign.webhookSecret) {
    return { configured: false, valid: true };
  }

  const signature = getHeader(headers, 'x-docusign-signature-1');
  if (!signature || !Buffer.isBuffer(rawBody)) {
    return { configured: true, valid: false };
  }

  const expected = crypto
    .createHmac('sha256', docusign.webhookSecret)
    .update(rawBody)
    .digest('base64');

  return {
    configured: true,
    valid: safeCompare(signature, expected),
  };
};

const getEnvelopeId = (payload) =>
  payload?.data?.envelopeId ||
  payload?.envelopeId ||
  payload?.EnvelopeStatus?.EnvelopeID ||
  null;

const getStatus = (payload) => {
  const rawStatus = String(
    payload?.data?.envelopeSummary?.status ||
      payload?.data?.status ||
      payload?.status ||
      payload?.event ||
      payload?.EnvelopeStatus?.Status ||
      ''
  )
    .trim()
    .toLowerCase();
  return statusAliases[rawStatus] || rawStatus;
};

const authorizeBackendWebhook = (req, res) => {
  const apiKey = getHeader(req.headers || {}, 'x-api-key');
  if (!process.env.BACKEND_API_KEY) {
    res.status(500).json({
      success: false,
      message: 'BACKEND_API_KEY is not configured',
    });
    return false;
  }
  if (apiKey !== process.env.BACKEND_API_KEY) {
    res.status(401).json({
      success: false,
      message: 'Invalid API key',
    });
    return false;
  }
  return true;
};

const getDailyPromptLocation = (foodTruck) => {
  const locations = foodTruck?.locations || [];
  const currentLocationId = foodTruck?.currentLocation?.toString();
  return (
    locations.find((location) => location._id?.toString() === currentLocationId) ||
    locations.find((location) => location.isOrderingOpen) ||
    locations[locations.length - 1] ||
    locations[0] ||
    null
  );
};

const parseTimeToMinutes = (value) => {
  const [hour, minute] = String(value || '')
    .split(':')
    .map((part) => Number(part));
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
};

const getZonedScheduleParts = (date, timeZone = DEFAULT_VENDOR_SCHEDULE_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = parts.reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
  const weekdayMap = {
    Sun: 'sun',
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
  };
  const hour = Number(values.hour === '24' ? '0' : values.hour);
  const minute = Number(values.minute || 0);

  return {
    day: weekdayMap[values.weekday] || dayKeys[date.getDay()],
    minutes: hour * 60 + minute,
    timeZone,
  };
};

const isMinuteInsideScheduleWindow = ({
  nowMinutes,
  startTime,
  endTime,
  afterMidnight = false,
}) => {
  const startMinutes = parseTimeToMinutes(startTime);
  let endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  const effectiveStart = startMinutes + WEEKLY_SCHEDULE_OPEN_BUFFER_MINUTES;
  const effectiveEnd = endMinutes - WEEKLY_SCHEDULE_CLOSE_BUFFER_MINUTES;
  if (effectiveEnd <= effectiveStart) {
    return false;
  }

  // An overnight slot belongs to two calendar days. Only add a day when the
  // caller is evaluating the previous day's slot after midnight. Adding a day
  // based only on the clock time makes that slot appear active again later on
  // the following evening.
  const normalizedNowMinutes = nowMinutes + (afterMidnight ? 24 * 60 : 0);

  return normalizedNowMinutes >= effectiveStart && normalizedNowMinutes < effectiveEnd;
};

const isScheduleSlotActive = ({ slot, today, nowMinutes }) => {
  const startMinutes = parseTimeToMinutes(slot?.startTime);
  const endMinutes = parseTimeToMinutes(slot?.endTime);
  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  const todayIndex = dayKeys.indexOf(today);
  const previousDay = dayKeys[(todayIndex + dayKeys.length - 1) % dayKeys.length];
  const crossesMidnight = endMinutes <= startMinutes;
  const isPreviousDayOvernight = crossesMidnight && slot.day === previousDay;
  const belongsToCurrentWindow = slot.day === today || isPreviousDayOvernight;

  return (
    belongsToCurrentWindow &&
    isMinuteInsideScheduleWindow({
      nowMinutes,
      startTime: slot.startTime,
      endTime: slot.endTime,
      afterMidnight: isPreviousDayOvernight,
    })
  );
};

const getOpenLocationId = (openLocation) =>
  openLocation.locationId?.toString() ||
  openLocation.location_id?.toString() ||
  openLocation._id?.toString() ||
  null;

const hasActiveScheduleOverride = (openLocation, now) =>
  openLocation?.status_source === 'MANUAL' &&
  openLocation?.schedule_override_until &&
  new Date(openLocation.schedule_override_until).getTime() > now.getTime();

const getActiveTruckUnits = (foodTruck) =>
  (foodTruck?.truck_units || []).filter((unit) => !unit.is_archived);

const getScheduleTruckUnitId = (foodTruck, slot) => {
  const explicitTruckUnitId = slot?.truckUnitId?.toString();
  if (explicitTruckUnitId) {
    return explicitTruckUnitId;
  }

  const activeTruckUnits = getActiveTruckUnits(foodTruck);
  return activeTruckUnits.length === 1
    ? activeTruckUnits[0]._id?.toString() || null
    : null;
};

const syncCurrentLocationFromOpenTruckUnits = (foodTruck) => {
  const openLocationIds = new Set();
  (foodTruck.truck_units || []).forEach((unit) => {
    if (unit.is_archived) {
      return;
    }
    (unit.open_locations || []).forEach((openLocation) => {
      const locationId = getOpenLocationId(openLocation);
      if (openLocation.isOrderingOpen && locationId) {
        openLocationIds.add(locationId);
      }
    });
  });

  let changed = false;
  const nextCurrentLocation = openLocationIds.values().next().value || null;

  (foodTruck.locations || []).forEach((location) => {
    const locationId = location._id?.toString();
    const nextOpen = openLocationIds.has(locationId);
    if (location.isOrderingOpen !== nextOpen) {
      location.isOrderingOpen = nextOpen;
      changed = true;
    }
  });

  if ((foodTruck.currentLocation?.toString() || null) !== nextCurrentLocation) {
    foodTruck.currentLocation = nextCurrentLocation;
    changed = true;
  }

  return changed;
};

const reconcileFoodTruckWeeklySchedule = (
  foodTruck,
  now = new Date(),
  timeZone = DEFAULT_VENDOR_SCHEDULE_TIME_ZONE
) => {
  const scheduleParts = getZonedScheduleParts(now, timeZone);
  const today = scheduleParts.day;
  const nowMinutes = scheduleParts.minutes;
  const activeLocationIds = new Set();
  const managedLocationIds = new Set();
  const activeUnitLocationPairs = new Set();
  const overrideUnitLocationPairs = new Set();

  (foodTruck.availability || [])
    .filter((slot) => slot.locationId && slot.available)
    .forEach((slot) => {
      const locationId = slot.locationId?.toString();
      const truckUnitId = getScheduleTruckUnitId(foodTruck, slot);
      if (!locationId || !truckUnitId) {
        return;
      }

      managedLocationIds.add(locationId);
      const isActive = isScheduleSlotActive({ slot, today, nowMinutes });

      if (isActive) {
        activeLocationIds.add(locationId);
        activeUnitLocationPairs.add(`${truckUnitId}:${locationId}`);
      }
    });

  let changed = false;

  (foodTruck.truck_units || []).forEach((unit) => {
    if (unit.is_archived) {
      return;
    }

    (unit.open_locations || []).forEach((openLocation) => {
      if (!hasActiveScheduleOverride(openLocation, now)) {
        return;
      }
      const locationId = getOpenLocationId(openLocation);
      if (locationId) {
        overrideUnitLocationPairs.add(`${unit._id?.toString()}:${locationId}`);
      }
    });
  });

  (foodTruck.truck_units || []).forEach((unit) => {
    if (unit.is_archived) {
      return;
    }

    const before = JSON.stringify(unit.open_locations || []);
    const pushedLocationIds = new Set();
    unit.open_locations = (unit.open_locations || []).filter((openLocation) => {
      const locationId = getOpenLocationId(openLocation);
      if (hasActiveScheduleOverride(openLocation, now)) {
        return true;
      }
      return !managedLocationIds.has(locationId);
    });

    (foodTruck.availability || [])
      .filter(
        (slot) =>
          slot.locationId &&
          slot.available &&
          isScheduleSlotActive({ slot, today, nowMinutes })
      )
      .forEach((slot) => {
        const locationId = slot.locationId?.toString();
        const truckUnitId = getScheduleTruckUnitId(foodTruck, slot);
        if (
          unit._id?.toString() === truckUnitId &&
          activeUnitLocationPairs.has(`${truckUnitId}:${locationId}`) &&
          !overrideUnitLocationPairs.has(`${truckUnitId}:${locationId}`) &&
          !pushedLocationIds.has(locationId)
        ) {
          pushedLocationIds.add(locationId);
          unit.open_locations.push({
            locationId,
            isOrderingOpen: true,
            updated_at: now,
            status_source: 'SCHEDULE',
            schedule_override_until: null,
            schedule_override_reason: null,
          });
        }
      });

    if (before !== JSON.stringify(unit.open_locations || [])) {
      changed = true;
    }
  });

  (foodTruck.locations || []).forEach((location) => {
    const locationId = location._id?.toString();
    if (!managedLocationIds.has(locationId)) {
      return;
    }
    const overrideOpen = (foodTruck.truck_units || []).some((unit) =>
      (unit.open_locations || []).some(
        (openLocation) =>
          getOpenLocationId(openLocation) === locationId &&
          hasActiveScheduleOverride(openLocation, now) &&
          !!openLocation.isOrderingOpen
      )
    );
    const overrideClosed = (foodTruck.truck_units || []).some((unit) =>
      (unit.open_locations || []).some(
        (openLocation) =>
          getOpenLocationId(openLocation) === locationId &&
          hasActiveScheduleOverride(openLocation, now) &&
          !openLocation.isOrderingOpen
      )
    );
    const nextOpen = overrideClosed ? false : overrideOpen || activeLocationIds.has(locationId);
    if (location.isOrderingOpen !== nextOpen) {
      location.isOrderingOpen = nextOpen;
      changed = true;
    }
  });

  if (syncCurrentLocationFromOpenTruckUnits(foodTruck)) {
    changed = true;
  }

  if (changed) {
    foodTruck.markModified('truck_units');
    foodTruck.markModified('locations');
    foodTruck.markModified('currentLocation');
  }

  let appliedOpenPairs = 0;
  (foodTruck.truck_units || []).forEach((unit) => {
    if (unit.is_archived) {
      return;
    }
    (unit.open_locations || []).forEach((openLocation) => {
      const locationId = getOpenLocationId(openLocation);
      if (openLocation.isOrderingOpen && locationId) {
        appliedOpenPairs += 1;
      }
    });
  });

  return {
    changed,
    openedLocations: activeLocationIds.size,
    scheduledOpenPairs: activeUnitLocationPairs.size,
    manualOverridePairs: overrideUnitLocationPairs.size,
    appliedOpenPairs,
    managedLocations: managedLocationIds.size,
  };
};

// Also reconcile on vendor-facing reads and manual status changes so ordering
// state does not depend on the maintenance webhook having run recently.
exports.reconcileFoodTruckWeeklySchedule = reconcileFoodTruckWeeklySchedule;

exports.vendorDailyLocationCheckReminders = async (req, res) => {
  if (!authorizeBackendWebhook(req, res)) {
    return;
  }

  const vendors = await UserModel.find(
    {
      userType: 'VENDOR',
      requestStatus: 'APPROVED',
      inactive: false,
      verified: true,
      'fcmTokens.0': { $exists: true },
    },
    { _id: 1, firstName: 1, lastName: 1, fcmTokens: 1 }
  ).lean();

  const foodTrucks = await FoodTruckModel.find(
    {
      userId: { $in: vendors.map((vendor) => vendor._id) },
      inactive: false,
      verified: true,
    },
    { _id: 1, userId: 1, name: 1, locations: 1, currentLocation: 1 }
  ).lean();

  const foodTruckByVendorId = new Map(
    foodTrucks.map((foodTruck) => [foodTruck.userId?.toString(), foodTruck])
  );

  let sent = 0;
  let skippedNoLocation = 0;

  for (const vendor of vendors) {
    const foodTruck = foodTruckByVendorId.get(vendor._id.toString());
    const location = getDailyPromptLocation(foodTruck);
    if (!foodTruck || !location) {
      skippedNoLocation += 1;
      continue;
    }

    await CustomNotification.sendVendorDailyLocationCheckNotification(
      vendor,
      foodTruck,
      location
    );
    sent += 1;
  }

  return res.data(
    {
      sent,
      skippedNoLocation,
      totalVendors: vendors.length,
    },
    'Vendor daily location check reminders sent'
  );
};

exports.vendorComplianceOcrResult = async (req, res) => {
  if (!authorizeBackendWebhook(req, res)) {
    return;
  }

  try {
    const document = await VendorComplianceService.applyOcrResult({
      documentId: req.params.documentId,
      ocrStatus: req.body?.ocr_status,
      extractedFields: req.body?.extracted_fields,
      errorMessage: req.body?.ocr_error_message,
    });

    return res.data(
      { complianceDocument: document },
      'Compliance OCR result processed'
    );
  } catch (error) {
    return res.status(error.code || 500).json({
      success: false,
      message: error.message || 'Compliance OCR result failed',
    });
  }
};

exports.vendorComplianceMaintenance = async (req, res) => {
  if (!authorizeBackendWebhook(req, res)) {
    return;
  }

  try {
    const result = await VendorComplianceService.runComplianceMaintenance();
    return res.data(result, 'Vendor compliance maintenance processed');
  } catch (error) {
    return res.status(error.code || 500).json({
      success: false,
      message: error.message || 'Vendor compliance maintenance failed',
    });
  }
};

exports.vendorWeeklyScheduleMaintenance = async (req, res) => {
  if (!authorizeBackendWebhook(req, res)) {
    return;
  }

  try {
    const foodTrucks = await FoodTruckModel.find({
      inactive: false,
      verified: true,
      'availability.0': { $exists: true },
    });
    const vendors = await UserModel.find(
      { _id: { $in: foodTrucks.map((foodTruck) => foodTruck.userId) } },
      { _id: 1, addressCity: 1, addressState: 1, addressPostal: 1 }
    ).lean();
    const vendorById = new Map(
      vendors.map((vendor) => [vendor._id?.toString(), vendor])
    );

    let updated = 0;
	    let openedLocations = 0;
	    let managedLocations = 0;
	    let scheduledOpenPairs = 0;
	    let manualOverridePairs = 0;
	    let appliedOpenPairs = 0;
	    const processedByTimeZone = {};
	    let employeeSchedulesProcessed = 0;
	    let employeeShiftsEnded = 0;

	    for (const foodTruck of foodTrucks) {
	      const vendor = vendorById.get(foodTruck.userId?.toString());
	      const cacheChanged = applyVendorScheduleTimeZoneCache(foodTruck, vendor);
	      const timeZone =
	        foodTruck.schedule_time_zone || DEFAULT_VENDOR_SCHEDULE_TIME_ZONE;
	      processedByTimeZone[timeZone] = (processedByTimeZone[timeZone] || 0) + 1;

      // Compliance remains visible/reviewable, but open/close automation is
      // intentionally schedule-driven while marketplace compliance is stabilized.

      const result = reconcileFoodTruckWeeklySchedule(foodTruck, new Date(), timeZone);
      openedLocations += result.openedLocations;
      managedLocations += result.managedLocations;
      scheduledOpenPairs += result.scheduledOpenPairs;
      manualOverridePairs += result.manualOverridePairs;
      appliedOpenPairs += result.appliedOpenPairs;

      if (result.changed || cacheChanged) {
        await foodTruck.save();
        updated += 1;
      }
    }

    const foodTruckById = new Map(foodTrucks.map((truck) => [String(truck._id), truck]));
    const scheduledEmployees = await VendorEmployeeModel.find({
      is_active: true,
      is_archived: false,
      $or: [
        { 'weekly_schedule.0': { $exists: true } },
        { 'schedule_assignments.0': { $exists: true } },
      ],
    });
    for (const employee of scheduledEmployees) {
      const truck = foodTruckById.get(String(employee.food_truck_id));
      if (!truck) continue;
      const activeSession = await EmployeeSessionModel.findOne({
        employee_internal_id: employee.employee_internal_id,
        food_truck_id: employee.food_truck_id,
        is_active: true,
      }).sort({ started_at: -1 });
      if (activeSession?.is_vendor_override) continue;
      const scheduleState = employee.schedule_assignments?.length
        ? getEmployeeScheduleAssignment(
            employee.schedule_assignments,
            new Date(),
            truck.schedule_time_zone || DEFAULT_VENDOR_SCHEDULE_TIME_ZONE
          ) || { withinWindow: false }
        : getEmployeeScheduleState(
            employee.weekly_schedule,
            new Date(),
            truck.schedule_time_zone || DEFAULT_VENDOR_SCHEDULE_TIME_ZONE
          );
      if (employee.is_working !== scheduleState.withinWindow) {
        employee.is_working = scheduleState.withinWindow;
        await employee.save();
      }
      if (!scheduleState.withinWindow && activeSession) {
        await EmployeeSessionService.endSession({
          employeeSessionId: activeSession.employee_session_id,
          employeeInternalId: employee.employee_internal_id,
        });
        employeeShiftsEnded += 1;
      }
      employeeSchedulesProcessed += 1;
    }

    return res.data(
      {
        processed: foodTrucks.length,
        updated,
        managedLocations,
	        openedLocations,
	        scheduledOpenPairs,
	        manualOverridePairs,
	        appliedOpenPairs,
	        employeeSchedulesProcessed,
	        employeeShiftsEnded,
	        openBufferMinutes: WEEKLY_SCHEDULE_OPEN_BUFFER_MINUTES,
        closeBufferMinutes: WEEKLY_SCHEDULE_CLOSE_BUFFER_MINUTES,
        fallbackScheduleTimeZone: DEFAULT_VENDOR_SCHEDULE_TIME_ZONE,
        processedByTimeZone,
      },
      'Vendor weekly schedule maintenance processed'
    );
  } catch (error) {
    return res.status(error.code || 500).json({
      success: false,
      message: error.message || 'Vendor weekly schedule maintenance failed',
    });
  }
};

exports.docusign = async (req, res) => {
  const timestamp = new Date().toISOString();
  const signature = verifySignature({
    rawBody: req.body,
    headers: req.headers || {},
  });

  if (signature.configured && !signature.valid) {
    console.warn('[DocuSign webhook] signature validation failed', {
      timestamp,
    });
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  let payload;
  try {
    payload = parseBody(req.body);
  } catch (error) {
    console.warn('[DocuSign webhook] invalid JSON payload', {
      timestamp,
      signatureValid: signature.valid,
    });
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }

  const envelopeId = getEnvelopeId(payload);
  const status = getStatus(payload);
  const accepted = acceptedStatuses.has(status);

  console.log('[DocuSign webhook] event received', {
    timestamp,
    envelopeId,
    status,
    signatureValid: signature.valid,
    signatureConfigured: signature.configured,
  });

  if (!envelopeId || !status) {
    return res.status(400).json({
      success: false,
      message: 'Missing envelope status',
    });
  }

  if (!accepted) {
    return res.data(
      {
        received: true,
        accepted: false,
        envelopeId,
        status,
      },
      'DocuSign webhook event ignored'
    );
  }

  // Later phase: connect this accepted event to marketplace bid agreement records.
  return res.data(
    {
      received: true,
      accepted: true,
      envelopeId,
      status,
    },
    'DocuSign webhook received'
  );
};
