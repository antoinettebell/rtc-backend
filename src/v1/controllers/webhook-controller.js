const crypto = require('crypto');
const { docusign } = require('../../config');
const { FoodTruckModel, UserModel } = require('../../models');
const CustomNotification = require('../../helper/custom-notification');
const VendorComplianceService = require('../services/vendor-compliance-service');
const {
  DEFAULT_VENDOR_SCHEDULE_TIME_ZONE,
  applyVendorScheduleTimeZoneCache,
} = require('../../helper/vendor-schedule-timezone');

const WEEKLY_SCHEDULE_OPEN_BUFFER_MINUTES = 60;
const WEEKLY_SCHEDULE_CLOSE_BUFFER_MINUTES = 60;
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

const isMinuteInsideScheduleWindow = ({ nowMinutes, startTime, endTime }) => {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return false;
  }

  const effectiveStart = startMinutes + WEEKLY_SCHEDULE_OPEN_BUFFER_MINUTES;
  const effectiveEnd = endMinutes - WEEKLY_SCHEDULE_CLOSE_BUFFER_MINUTES;
  if (effectiveEnd <= effectiveStart) {
    return false;
  }

  return nowMinutes >= effectiveStart && nowMinutes < effectiveEnd;
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
      const truckUnitId = slot.truckUnitId?.toString() || null;
      if (!locationId || !truckUnitId) {
        return;
      }

      managedLocationIds.add(locationId);
      if (slot.day !== today) {
        return;
      }

      const isActive = isMinuteInsideScheduleWindow({
        nowMinutes,
        startTime: slot.startTime,
        endTime: slot.endTime,
      });

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
      .filter((slot) => slot.day === today && slot.locationId && slot.available)
      .forEach((slot) => {
        const locationId = slot.locationId?.toString();
        const truckUnitId = slot.truckUnitId?.toString() || null;
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

  if (changed) {
    foodTruck.markModified('truck_units');
    foodTruck.markModified('locations');
  }

  return {
    changed,
    openedLocations: activeLocationIds.size,
    managedLocations: managedLocationIds.size,
  };
};

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
	    const processedByTimeZone = {};

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

      if (result.changed || cacheChanged) {
        await foodTruck.save();
        updated += 1;
      }
    }

    return res.data(
      {
        processed: foodTrucks.length,
        updated,
        managedLocations,
	        openedLocations,
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
