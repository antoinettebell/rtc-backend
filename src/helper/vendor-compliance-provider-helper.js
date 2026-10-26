const axios = require('axios');
const crypto = require('crypto');
const {
  FoodTruckModel,
  UserModel,
  VendorComplianceProviderVerificationModel,
  CoordinatorComplianceProviderVerificationModel,
  CoordinatorComplianceProfileModel,
  MarketplaceVendorComplianceProviderVerificationModel,
  MarketplaceVendorComplianceProfileModel,
} = require('../models');
const EncryptionService = require('./encryption');

const enabled = () => String(process.env.COMPLIANCE_EXTERNAL_VERIFICATION_ENABLED || 'false').toLowerCase() === 'true';
const cobaltTestMode = () => String(process.env.COBALT_TEST_MODE || 'false').toLowerCase() === 'true';
// Cobalt TIN checks normally return immediately. A pending response has no
// pollable reference, so let an explicit later action recover only after the
// provider's duplicate-submission window has had time to clear.
const COBALT_TIN_STALE_RETRY_MS = 15 * 60 * 1000;
// A State search can be asynchronous. Keep polling a Cobalt retry reference,
// but never leave a vendor in an indefinite pending state when the provider
// does not return a final result.
const COBALT_SOS_PENDING_TIMEOUT_MS = 30 * 60 * 1000;
const cobaltTestParams = () => cobaltTestMode() ? { test: 'complete' } : {};
const cobaltSosParams = (businessName, state) => (cobaltTestMode()
  ? { searchQuery: businessName, state, test: 'complete' }
  : { searchQuery: businessName, state, liveData: true });
const fingerprint = (value) => crypto.createHmac('sha256', process.env.COMPLIANCE_FINGERPRINT_SECRET || process.env.ENCRYPTION_SECRET_KEY || 'disabled')
  .update(value).digest('hex');
const safeReason = (value) => String(value || '').slice(0, 300);
const formatSsnForComplyCube = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 9) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};
const formatEinForCobalt = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 9 ? digits : null;
};
const complyCubeRequestOptions = () => ({
  headers: { Authorization: process.env.COMPLYCUBE_API_KEY }, timeout: 15000,
});
const markProviderOperation = (error, operation) => {
  // The caller logs only this operation label plus safe transport metadata.
  // Do not attach request data, credentials, or provider response bodies.
  error.compliance_provider_operation = operation;
  return error;
};
const createComplyCubeClient = async (clientPayload) => {
  try {
    return await axios.post('https://api.complycube.com/v1/clients', clientPayload, complyCubeRequestOptions());
  } catch (error) {
    throw markProviderOperation(error, 'create_client');
  }
};
const upsertComplyCubeClient = async ({ previousClientId, clientPayload }) => {
  if (previousClientId) {
    try {
      const response = await axios.patch(
        `https://api.complycube.com/v1/clients/${previousClientId}`,
        clientPayload,
        complyCubeRequestOptions()
      );
      return response.data?.id || previousClientId;
    } catch (error) {
      // A provider-side client can be removed independently of our historical
      // record. Recreate it once on a genuine missing-client response.
      if (error?.response?.status !== 404) throw markProviderOperation(error, 'update_client');
    }
  }
  const response = await createComplyCubeClient(clientPayload);
  const clientId = response.data?.id;
  if (!clientId) throw new Error('ComplyCube did not return a client ID');
  return clientId;
};
const createComplyCubeSsnCheck = async (clientId) => {
  try {
    return await axios.post('https://api.complycube.com/v1/checks', {
      clientId, type: 'ssn_check',
    }, complyCubeRequestOptions());
  } catch (error) {
    throw markProviderOperation(error, 'create_ssn_check');
  }
};
const normalizeComplyCube = (check = {}) => {
  const outcome = String(check?.result?.outcome || check?.outcome || '').toLowerCase();
  const status = String(check?.status || '').toLowerCase();
  if (status === 'complete' && outcome === 'clear') return 'PASSED';
  // A completed provider check has reached a final provider outcome. We do
  // not expose a manual-review workflow in the apps; the vendor can correct
  // their legal-payee data and submit a fresh verification cycle instead.
  if (status === 'complete' && outcome === 'attention') return 'FAILED';
  if (['failed', 'rejected'].includes(status)) return 'FAILED';
  return 'PENDING';
};
const normalizeCobaltTin = (result = {}) => {
  const status = String(result.status || '').toLowerCase();
  if (status === 'tin matched') return 'PASSED';
  if (status === 'did not match') return 'FAILED';
  if (status === 'in review') return 'PENDING';
  if (String(result.irsServiceStatus || '').toUpperCase().includes('OUTAGE')) return 'RETRYABLE_ERROR';
  return 'PENDING';
};
const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')
  // State registries commonly render legal suffixes with punctuation (for
  // example, "L.L.C."), while the compliance form stores "LLC". Treat
  // formatting-only variants as the same legal suffix without relaxing the
  // actual business-name, State, or active/good-standing checks.
  .replace(/\bl\s+l\s+c\b/g, 'llc')
  .replace(/\bp\s+l\s+l\s+c\b/g, 'pllc')
  .replace(/\bl\s+l\s+p\b/g, 'llp')
  .replace(/\bincorporated\b/g, 'inc')
  .replace(/\bcorporation\b/g, 'corp')
  .replace(/\blimited\b/g, 'ltd')
  // The entity designator identifies the legal form, not a different
  // business. A license or State registry may omit it entirely.
  .replace(/\s+\b(?:llc|pllc|llp|inc|corp|ltd)\b$/g, '')
  .replace(/\s+/g, ' ');
const normalizeState = (value) => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
const normalizeCobaltSos = (result = {}, foodTruck = {}) => {
  if (result.retryId) return 'PENDING';
  const providerMessage = String(result.status || result.message || '');
  if (/retry\s*id\s*invalid/i.test(providerMessage)) return 'RETRYABLE_ERROR';
  const expectedNames = new Set(
    [foodTruck.legal_business_name, foodTruck.dba]
      .map(normalizeName)
      .filter(Boolean)
  );
  const expectedState = normalizeState(foodTruck.business_registration_state);
  const match = (result.results || []).find((candidate) => {
    const candidateName = normalizeName(candidate?.title || candidate?.businessName || candidate?.name);
    const candidateState = normalizeState(candidate?.stateOfSosRegistration || candidate?.state || candidate?.stateOfFormation);
    const active = /active|good standing/i.test(String(candidate?.status || ''));
    // The request itself is state-scoped. Some states return a full state name
    // while the profile stores the two-letter code, so only reject an explicit
    // conflicting abbreviation here.
    return expectedNames.has(candidateName) && active && (
      !expectedState || !candidateState || candidateState.length > 2 || candidateState === expectedState
    );
  });
  if (match) return 'PASSED';
  if (Array.isArray(result.results) && result.results.length) return 'FAILED';
  if (/failed|invalid|not found/i.test(providerMessage)) return 'FAILED';
  // An empty non-error State response is not a decision. Cobalt normally
  // follows it with a retry reference/result, which maintenance will poll.
  return 'PENDING';
};
const cobaltSosSafeReason = (status) => {
  if (status === 'PENDING') return 'Secretary of State search is still pending.';
  if (status === 'PASSED') return 'Secretary of State record matched the legal business profile.';
  if (status === 'RETRYABLE_ERROR') return 'Cobalt did not accept the State retry reference. A new State verification can be requested.';
  return 'Secretary of State result did not satisfy the legal business profile check.';
};

const upsert = async ({ foodTruck, provider, checkType, values }) =>
  VendorComplianceProviderVerificationModel.findOneAndUpdate(
    { food_truck_id: foodTruck._id, verification_cycle: Math.max(1, Number(foodTruck.compliance_verification_cycle || 1)), provider, check_type: checkType },
    { $set: { vendor_user_id: foodTruck.userId, ...values } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const currentRecord = ({ foodTruck, provider, checkType }) =>
  VendorComplianceProviderVerificationModel.findOne({
    food_truck_id: foodTruck._id,
    verification_cycle: Math.max(1, Number(foodTruck.compliance_verification_cycle || 1)),
    provider,
    check_type: checkType,
  }).exec();

const activeOrTerminalRecord = (record) =>
  record && ['PENDING', 'PASSED', 'FAILED'].includes(record.status);
const stalePendingCobaltTin = (record, now = Date.now()) =>
  record?.status === 'PENDING'
  && !record.provider_reference
  && record.submitted_at
  && now - new Date(record.submitted_at).getTime() >= COBALT_TIN_STALE_RETRY_MS;
const timedOutPendingCobaltSos = (record, now = Date.now()) =>
  record?.status === 'PENDING'
  && record.submitted_at
  && now - new Date(record.submitted_at).getTime() >= COBALT_SOS_PENDING_TIMEOUT_MS;

const saveCobaltSosPollResult = async ({ record, result, identity }) => {
  const providerStatus = normalizeCobaltSos(result, identity);
  record.status = providerStatus === 'PENDING' && timedOutPendingCobaltSos(record)
    ? 'RETRYABLE_ERROR'
    : providerStatus;
  record.provider_reference = result.retryId || record.provider_reference;
  record.retry_count = Number(record.retry_count || 0) + 1;
  record.safe_reason = record.status === 'RETRYABLE_ERROR' && providerStatus === 'PENDING'
    ? 'State verification timed out. A new State verification can be requested.'
    : cobaltSosSafeReason(record.status);
  if (['PASSED', 'FAILED', 'RETRYABLE_ERROR'].includes(record.status)) record.completed_at = new Date();
  await record.save();
  return record;
};

// A provider result normally arrives through the signed webhook. This manual
// refresh is deliberately limited to an already-pending ComplyCube check so a
// user can recover from a previously disabled/misconfigured webhook without
// creating a duplicate check or resending any identity fields.
const refreshPendingComplyCubeCheck = async (record) => {
  if (!record || record.status !== 'PENDING' || !record.provider_reference) return record;
  const response = await axios.get(`https://api.complycube.com/v1/checks/${record.provider_reference}`, {
    headers: { Authorization: process.env.COMPLYCUBE_API_KEY }, timeout: 15000,
  });
  const check = response.data || {};
  record.status = normalizeComplyCube(check);
  record.safe_result_code = String(check?.result?.outcome || check?.outcome || '').toLowerCase() || null;
  record.safe_reason = record.status === 'FAILED' ? 'ComplyCube could not verify the submitted identity.' : null;
  if (['PASSED', 'FAILED'].includes(record.status)) record.completed_at = new Date();
  await record.save();
  return record;
};

const startComplyCubeSsnCheck = async (foodTruck) => {
  if (!enabled() || !process.env.COMPLYCUBE_API_KEY) return null;
  const existing = await currentRecord({ foodTruck, provider: 'COMPLYCUBE', checkType: 'SSN' });
  if (existing?.status === 'PENDING') return refreshPendingComplyCubeCheck(existing);
  if (activeOrTerminalRecord(existing)) return existing;
  const user = await UserModel.findById(foodTruck.userId).lean();
  const ssn = formatSsnForComplyCube(EncryptionService.decrypt(foodTruck.tax_identifier_encrypted));
  if (!ssn || !user?.firstName || !user?.lastName || !user?.email) throw new Error('SSN verification profile is incomplete');
  const previous = await VendorComplianceProviderVerificationModel.findOne({
    food_truck_id: foodTruck._id,
    provider: 'COMPLYCUBE',
    check_type: 'SSN',
    provider_client_reference: { $ne: null },
  }).sort({ created_at: -1 }).lean();
  const clientPayload = {
    type: 'person', email: user.email, externalId: `rtc-vendor-${foodTruck._id}`,
    personDetails: { firstName: user.firstName, lastName: user.lastName, ssn },
  };
  const clientId = await upsertComplyCubeClient({
    previousClientId: previous?.provider_client_reference,
    clientPayload,
  });
  const checkResponse = await createComplyCubeSsnCheck(clientId);
  const check = checkResponse.data || {};
  return upsert({ foodTruck, provider: 'COMPLYCUBE', checkType: 'SSN', values: {
    status: normalizeComplyCube(check), provider_reference: check.id || null, provider_client_reference: clientId || null,
    request_fingerprint: fingerprint(`SSN:${foodTruck.tax_identifier_masked}`), submitted_at: new Date(),
  } });
};

const coordinatorNameParts = (legalName) => {
  const parts = String(legalName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
};

const startCoordinatorComplyCubeSsnCheck = async ({ coordinator, profile }) => {
  if (!enabled() || !process.env.COMPLYCUBE_API_KEY) return null;
  const verificationCycle = Math.max(1, Number(profile.external_verification_cycle || 1));
  const existing = await CoordinatorComplianceProviderVerificationModel.findOne({
    coordinator_user_id: coordinator._id,
    verification_cycle: verificationCycle,
    provider: 'COMPLYCUBE',
    check_type: 'SSN',
  }).exec();
  if (existing?.status === 'PENDING') return refreshPendingComplyCubeCheck(existing);
  if (activeOrTerminalRecord(existing)) return existing;
  const name = coordinatorNameParts(profile.legal_name);
  const ssn = formatSsnForComplyCube(EncryptionService.decrypt(profile.tax_id_encrypted));
  if (!name || !ssn || !coordinator?.email) throw new Error('SSN verification profile is incomplete');
  const previous = await CoordinatorComplianceProviderVerificationModel.findOne({
    coordinator_user_id: coordinator._id,
    provider: 'COMPLYCUBE',
    check_type: 'SSN',
    provider_client_reference: { $ne: null },
  }).sort({ created_at: -1 }).lean();
  const clientPayload = {
    type: 'person',
    email: coordinator.email,
    externalId: `rtc-coordinator-${coordinator._id}`,
    personDetails: { ...name, ssn },
  };
  const clientId = await upsertComplyCubeClient({
    previousClientId: previous?.provider_client_reference,
    clientPayload,
  });
  const checkResponse = await createComplyCubeSsnCheck(clientId);
  const check = checkResponse.data || {};
  return CoordinatorComplianceProviderVerificationModel.findOneAndUpdate(
    { coordinator_user_id: coordinator._id, verification_cycle: verificationCycle, provider: 'COMPLYCUBE', check_type: 'SSN' },
    {
      $set: {
        status: normalizeComplyCube(check),
        provider_reference: check.id || null,
        provider_client_reference: clientId || null,
        request_fingerprint: fingerprint(`SSN:${profile.tax_id_masked}`),
        submitted_at: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const startCobaltEinChecks = async (foodTruck, { checkType = null } = {}) => {
  if (!enabled() || !process.env.COBALT_API_KEY) return [];
  if (String(process.env.COBALT_ALLOW_EIN_QUERY_TRANSMISSION || 'false').toLowerCase() !== 'true') {
    throw new Error('Cobalt EIN query transmission requires explicit authorization');
  }
  const [existingTin, existingSos] = await Promise.all([
    currentRecord({ foodTruck, provider: 'COBALT', checkType: 'TIN' }),
    currentRecord({ foodTruck, provider: 'COBALT', checkType: 'SOS' }),
  ]);
  const shouldStartTin = checkType !== 'SOS'
    && (!activeOrTerminalRecord(existingTin) || stalePendingCobaltTin(existingTin));
  // A failed SOS lookup is safe to retry on an explicit user action.  Do not
  // resend an active TIN request: Cobalt flags duplicate TIN submissions.
  // A pending check without a reference becomes retryable only after the
  // bounded stale window above.
  const shouldStartSos = checkType !== 'TIN'
    && (!existingSos || ['FAILED', 'RETRYABLE_ERROR', 'MANUAL_REVIEW'].includes(existingSos.status));
  if (!shouldStartTin && !shouldStartSos) {
    if (existingSos?.status === 'PENDING' && existingSos.provider_reference) {
      try {
        const response = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
          params: { retryId: existingSos.provider_reference },
          headers: { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY },
          timeout: 35000,
        });
        const result = response.data || {};
        await saveCobaltSosPollResult({ record: existingSos, result, identity: foodTruck });
      } catch (_) {
        // Keep the existing pending retry ID. A manual refresh must not create
        // another State search when Cobalt is temporarily unavailable.
      }
    }
    return [existingTin, existingSos];
  }
  const tin = formatEinForCobalt(EncryptionService.decrypt(foodTruck.tax_identifier_encrypted));
  const businessName = foodTruck.legal_business_name;
  if (!tin || !businessName || !foodTruck.business_registration_state || !foodTruck.legal_business_type) {
    throw new Error('EIN verification profile is incomplete');
  }
  const headers = { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY };
  let tinRecord = existingTin;
  if (shouldStartTin) {
    const tinResponse = await axios.get('https://apigateway.cobaltintelligence.com/tinVerification', {
      params: { tin, businessName }, headers, timeout: 20000,
    });
    const tinResult = tinResponse.data || {};
    tinRecord = await upsert({ foodTruck, provider: 'COBALT', checkType: 'TIN', values: {
      status: normalizeCobaltTin(tinResult), request_fingerprint: fingerprint(`EIN:${foodTruck.tax_identifier_masked}`),
      safe_result_code: tinResult.irsCode === undefined ? null : String(tinResult.irsCode), safe_reason: safeReason(tinResult.irsReason),
      retry_count: Number(existingTin?.retry_count || 0) + (existingTin ? 1 : 0), submitted_at: new Date(),
    } });
  }
  let sosRecord = existingSos;
  if (shouldStartSos) {
    const sosResponse = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
      params: cobaltSosParams(businessName, foodTruck.business_registration_state), headers, timeout: 35000,
    });
    const sos = sosResponse.data || {};
    const sosStatus = normalizeCobaltSos(sos, foodTruck);
    sosRecord = await upsert({ foodTruck, provider: 'COBALT', checkType: 'SOS', values: {
      status: sosStatus, provider_reference: sos.retryId || sos.requestId || null,
      safe_reason: cobaltSosSafeReason(sosStatus),
      submitted_at: new Date(),
    } });
  }
  return [tinRecord, sosRecord];
};

const startCoordinatorCobaltEinChecks = async ({ coordinator, profile, checkType = null }) => {
  if (!enabled() || !process.env.COBALT_API_KEY) return [];
  if (String(process.env.COBALT_ALLOW_EIN_QUERY_TRANSMISSION || 'false').toLowerCase() !== 'true') {
    throw new Error('Cobalt EIN query transmission requires explicit authorization');
  }
  const verificationCycle = Math.max(1, Number(profile.external_verification_cycle || 1));
  const recordFor = (checkType) => CoordinatorComplianceProviderVerificationModel.findOne({
    coordinator_user_id: coordinator._id,
    verification_cycle: verificationCycle,
    provider: 'COBALT',
    check_type: checkType,
  }).exec();
  const [existingTin, existingSos] = await Promise.all([recordFor('TIN'), recordFor('SOS')]);
  const shouldStartTin = checkType !== 'SOS'
    && (!activeOrTerminalRecord(existingTin) || stalePendingCobaltTin(existingTin));
  const shouldStartSos = checkType !== 'TIN'
    && (!existingSos || ['FAILED', 'RETRYABLE_ERROR', 'MANUAL_REVIEW'].includes(existingSos.status));
  if (!shouldStartTin && !shouldStartSos) {
    if (existingSos?.status === 'PENDING' && existingSos.provider_reference) {
      try {
        const response = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
          params: { retryId: existingSos.provider_reference },
          headers: { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY },
          timeout: 35000,
        });
        const result = response.data || {};
        await saveCobaltSosPollResult({ record: existingSos, result, identity: {
          legal_business_name: profile.legal_name,
          dba: profile.dba_name,
          business_registration_state: profile.registration_state,
        } });
      } catch (_) {
        // Preserve the retry ID and avoid creating another State search.
      }
    }
    return [existingTin, existingSos];
  }
  const tin = formatEinForCobalt(EncryptionService.decrypt(profile.tax_id_encrypted));
  const businessName = profile.legal_name;
  if (!tin || !businessName || !profile.registration_state || !profile.entity_type) {
    throw new Error('EIN verification profile is incomplete');
  }
  const headers = { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY };
  const save = (checkType, values) => CoordinatorComplianceProviderVerificationModel.findOneAndUpdate(
    {
      coordinator_user_id: coordinator._id,
      verification_cycle: verificationCycle,
      provider: 'COBALT',
      check_type: checkType,
    },
    { $set: values },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  let tinRecord = existingTin;
  if (shouldStartTin) {
    const tinResponse = await axios.get('https://apigateway.cobaltintelligence.com/tinVerification', {
      params: { tin, businessName }, headers, timeout: 20000,
    });
    const tinResult = tinResponse.data || {};
    tinRecord = await save('TIN', {
      status: normalizeCobaltTin(tinResult),
      request_fingerprint: fingerprint(`EIN:${profile.tax_id_masked}`),
      safe_result_code: tinResult.irsCode === undefined ? null : String(tinResult.irsCode),
      safe_reason: safeReason(tinResult.irsReason),
      submitted_at: new Date(),
    });
  }
  let sosRecord = existingSos;
  if (shouldStartSos) {
    const sosResponse = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
      params: cobaltSosParams(businessName, profile.registration_state),
      headers,
      timeout: 35000,
    });
    const sos = sosResponse.data || {};
    const sosStatus = normalizeCobaltSos(sos, {
      legal_business_name: profile.legal_name,
      dba: profile.dba_name,
      business_registration_state: profile.registration_state,
    });
    sosRecord = await save('SOS', {
      status: sosStatus,
      provider_reference: sos.retryId || sos.requestId || null,
      safe_reason: cobaltSosSafeReason(sosStatus),
      submitted_at: new Date(),
    });
  }
  return [tinRecord, sosRecord];
};

const startMarketplaceVendorComplyCubeSsnCheck = async ({ vendor, profile }) => {
  if (!enabled() || !process.env.COMPLYCUBE_API_KEY) return null;
  const verificationCycle = Math.max(1, Number(profile.external_verification_cycle || 1));
  const existing = await MarketplaceVendorComplianceProviderVerificationModel.findOne({
    vendor_user_id: vendor._id,
    verification_cycle: verificationCycle,
    provider: 'COMPLYCUBE',
    check_type: 'SSN',
  }).exec();
  if (existing?.status === 'PENDING') return refreshPendingComplyCubeCheck(existing);
  if (activeOrTerminalRecord(existing)) return existing;
  // Marketplace Vendors use the same legal-name split required by the
  // existing coordinator ComplyCube SSN check. Keep the request shape and
  // validation identical; only the persistence model differs.
  const name = coordinatorNameParts(profile.legal_name);
  const ssn = formatSsnForComplyCube(EncryptionService.decrypt(profile.tax_id_encrypted));
  if (!name || !ssn || !vendor?.email) throw new Error('SSN verification profile is incomplete');
  const previous = await MarketplaceVendorComplianceProviderVerificationModel.findOne({
    vendor_user_id: vendor._id,
    provider: 'COMPLYCUBE',
    check_type: 'SSN',
    provider_client_reference: { $ne: null },
  }).sort({ created_at: -1 }).lean();
  const clientPayload = {
    type: 'person',
    email: vendor.email,
    externalId: `rtc-marketplace-vendor-${vendor._id}`,
    personDetails: { ...name, ssn },
  };
  const clientId = await upsertComplyCubeClient({
    previousClientId: previous?.provider_client_reference,
    clientPayload,
  });
  const checkResponse = await createComplyCubeSsnCheck(clientId);
  const check = checkResponse.data || {};
  return MarketplaceVendorComplianceProviderVerificationModel.findOneAndUpdate(
    { vendor_user_id: vendor._id, verification_cycle: verificationCycle, provider: 'COMPLYCUBE', check_type: 'SSN' },
    {
      $set: {
        marketplace_vendor_profile_id: profile.marketplace_vendor_profile_id,
        status: normalizeComplyCube(check),
        provider_reference: check.id || null,
        provider_client_reference: clientId || null,
        request_fingerprint: fingerprint(`SSN:${profile.tax_id_masked}`),
        submitted_at: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};


const startMarketplaceVendorCobaltEinChecks = async ({ vendor, profile, checkType = null }) => {
  if (!enabled() || !process.env.COBALT_API_KEY) return [];
  if (String(process.env.COBALT_ALLOW_EIN_QUERY_TRANSMISSION || 'false').toLowerCase() !== 'true') {
    throw new Error('Cobalt EIN query transmission requires explicit authorization');
  }
  const verificationCycle = Math.max(1, Number(profile.external_verification_cycle || 1));
  const recordFor = (checkType) => MarketplaceVendorComplianceProviderVerificationModel.findOne({
    vendor_user_id: vendor._id,
    verification_cycle: verificationCycle,
    provider: 'COBALT',
    check_type: checkType,
  }).exec();
  const [existingTin, existingSos] = await Promise.all([recordFor('TIN'), recordFor('SOS')]);
  const shouldStartTin = checkType !== 'SOS'
    && (!activeOrTerminalRecord(existingTin) || stalePendingCobaltTin(existingTin));
  const shouldStartSos = checkType !== 'TIN'
    && (!existingSos || ['FAILED', 'RETRYABLE_ERROR', 'MANUAL_REVIEW'].includes(existingSos.status));
  if (!shouldStartTin && !shouldStartSos) {
    if (existingSos?.status === 'PENDING' && existingSos.provider_reference) {
      try {
        const response = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
          params: { retryId: existingSos.provider_reference },
          headers: { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY },
          timeout: 35000,
        });
        const result = response.data || {};
        await saveCobaltSosPollResult({ record: existingSos, result, identity: {
          legal_business_name: profile.legal_name,
          dba: profile.dba_name,
          business_registration_state: profile.registration_state,
        } });
      } catch (_) {
        // Preserve the retry ID and avoid creating another State search.
      }
    }
    return [existingTin, existingSos];
  }
  const tin = formatEinForCobalt(EncryptionService.decrypt(profile.tax_id_encrypted));
  const businessName = profile.legal_name;
  if (!tin || !businessName || !profile.registration_state || !profile.entity_type) {
    throw new Error('EIN verification profile is incomplete');
  }
  const headers = { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY };
  const save = (checkType, values) => MarketplaceVendorComplianceProviderVerificationModel.findOneAndUpdate(
    {
      vendor_user_id: vendor._id,
      verification_cycle: verificationCycle,
      provider: 'COBALT',
      check_type: checkType,
    },
    { $set: { marketplace_vendor_profile_id: profile.marketplace_vendor_profile_id, ...values } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  let tinRecord = existingTin;
  if (shouldStartTin) {
    const tinResponse = await axios.get('https://apigateway.cobaltintelligence.com/tinVerification', {
      params: { tin, businessName }, headers, timeout: 20000,
    });
    const tinResult = tinResponse.data || {};
    tinRecord = await save('TIN', {
      status: normalizeCobaltTin(tinResult),
      request_fingerprint: fingerprint(`EIN:${profile.tax_id_masked}`),
      safe_result_code: tinResult.irsCode === undefined ? null : String(tinResult.irsCode),
      safe_reason: safeReason(tinResult.irsReason),
      submitted_at: new Date(),
    });
  }
  let sosRecord = existingSos;
  if (shouldStartSos) {
    const sosResponse = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
      params: cobaltSosParams(businessName, profile.registration_state),
      headers,
      timeout: 35000,
    });
    const sos = sosResponse.data || {};
    const sosStatus = normalizeCobaltSos(sos, {
      legal_business_name: profile.legal_name,
      dba: profile.dba_name,
      business_registration_state: profile.registration_state,
    });
    sosRecord = await save('SOS', {
      status: sosStatus,
      provider_reference: sos.retryId || sos.requestId || null,
      safe_reason: cobaltSosSafeReason(sosStatus),
      submitted_at: new Date(),
    });
  }
  return [tinRecord, sosRecord];
};



const pollPendingCobaltSosChecks = async () => {
  if (!enabled() || !process.env.COBALT_API_KEY) return 0;
  if (String(process.env.COBALT_ALLOW_EIN_QUERY_TRANSMISSION || 'false').toLowerCase() !== 'true') return 0;
  const pending = await VendorComplianceProviderVerificationModel.find({
    provider: 'COBALT', check_type: 'SOS', status: { $in: ['PENDING', 'MANUAL_REVIEW'] }, provider_reference: { $ne: null },
  }).limit(50).exec();
  let processed = 0;
  for (const record of pending) {
    try {
      const foodTruck = await FoodTruckModel.findById(record.food_truck_id)
        .select('legal_business_name dba name business_registration_state')
        .lean();
      if (!foodTruck) continue;
      const response = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
        params: { retryId: record.provider_reference },
        headers: { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY },
        timeout: 35000,
      });
      const result = response.data || {};
      await saveCobaltSosPollResult({ record, result, identity: foodTruck });
      processed += 1;
    } catch (_) {
      // The retry record remains pending; do not persist provider error bodies.
    }
  }
  const pendingCoordinatorChecks = await CoordinatorComplianceProviderVerificationModel.find({
    provider: 'COBALT', check_type: 'SOS', status: { $in: ['PENDING', 'MANUAL_REVIEW'] }, provider_reference: { $ne: null },
  }).limit(50).exec();
  for (const record of pendingCoordinatorChecks) {
    try {
      const profile = await CoordinatorComplianceProfileModel.findOne({
        coordinator_user_id: record.coordinator_user_id,
      }).select('legal_name dba_name registration_state').lean();
      if (!profile) continue;
      const response = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
        params: { retryId: record.provider_reference },
        headers: { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY },
        timeout: 35000,
      });
      const result = response.data || {};
      await saveCobaltSosPollResult({ record, result, identity: {
        legal_business_name: profile.legal_name,
        dba: profile.dba_name,
        business_registration_state: profile.registration_state,
      } });
      processed += 1;
    } catch (_) {
      // The retry record remains pending; do not persist provider error bodies.
    }
  }
  const pendingMarketplaceChecks = await MarketplaceVendorComplianceProviderVerificationModel.find({
    provider: 'COBALT', check_type: 'SOS', status: { $in: ['PENDING', 'MANUAL_REVIEW'] }, provider_reference: { $ne: null },
  }).limit(50).exec();
  for (const record of pendingMarketplaceChecks) {
    try {
      const profile = await MarketplaceVendorComplianceProfileModel.findOne({
        vendor_user_id: record.vendor_user_id,
      }).select('legal_name dba_name registration_state').lean();
      if (!profile) continue;
      const response = await axios.get('https://apigateway.cobaltintelligence.com/v1/search', {
        params: { retryId: record.provider_reference },
        headers: { Accept: 'application/json', 'x-api-key': process.env.COBALT_API_KEY },
        timeout: 35000,
      });
      await saveCobaltSosPollResult({ record, result: response.data || {}, identity: {
        legal_business_name: profile.legal_name,
        dba: profile.dba_name,
        business_registration_state: profile.registration_state,
      } });
      processed += 1;
    } catch (_) {
      // Keep the retry record pending until Cobalt returns a final result.
    }
  }
  return processed;
};

const applyProviderResult = async ({ provider, providerReference, status, safeResultCode = null, safeReason = null, webhookEventReference = null }) => {
  const record = await VendorComplianceProviderVerificationModel.findOne({
    provider: String(provider || '').toUpperCase(),
    provider_reference: providerReference,
  });
  if (!record) return null;
  if (webhookEventReference && record.webhook_event_reference === webhookEventReference) return record;
  const nextStatus = String(status || '').toUpperCase() === 'MANUAL_REVIEW' ? 'FAILED' : String(status || '').toUpperCase();
  const terminal = ['PASSED', 'FAILED'];
  if (terminal.includes(record.status) && record.status !== nextStatus) return record;
  record.status = nextStatus;
  record.safe_result_code = safeResultCode || record.safe_result_code;
  record.safe_reason = safeReason || record.safe_reason;
  record.webhook_event_reference = webhookEventReference || record.webhook_event_reference;
  if (terminal.includes(nextStatus)) record.completed_at = new Date();
  await record.save();
  return record;
};

const applyCoordinatorProviderResult = async ({ provider, providerReference, status, safeResultCode = null, safeReason = null, webhookEventReference = null }) => {
  const record = await CoordinatorComplianceProviderVerificationModel.findOne({
    provider: String(provider || '').toUpperCase(),
    provider_reference: providerReference,
  });
  if (!record) return null;
  if (webhookEventReference && record.webhook_event_reference === webhookEventReference) return record;
  const nextStatus = String(status || '').toUpperCase() === 'MANUAL_REVIEW' ? 'FAILED' : String(status || '').toUpperCase();
  const terminal = ['PASSED', 'FAILED'];
  if (terminal.includes(record.status) && record.status !== nextStatus) return record;
  record.status = nextStatus;
  record.safe_result_code = safeResultCode || record.safe_result_code;
  record.safe_reason = safeReason || record.safe_reason;
  record.webhook_event_reference = webhookEventReference || record.webhook_event_reference;
  if (terminal.includes(nextStatus)) record.completed_at = new Date();
  await record.save();
  return record;
};

const applyMarketplaceVendorProviderResult = async ({ provider, providerReference, status, safeResultCode = null, safeReason = null, webhookEventReference = null }) => {
  const record = await MarketplaceVendorComplianceProviderVerificationModel.findOne({
    provider: String(provider || '').toUpperCase(),
    provider_reference: providerReference,
  });
  if (!record) return null;
  record.status = String(status || '').toUpperCase() === 'MANUAL_REVIEW' ? 'FAILED' : String(status || '').toUpperCase();
  record.safe_result_code = safeResultCode || null;
  record.safe_reason = safeReason || null;
  record.webhook_event_reference = webhookEventReference || null;
  if (['PASSED', 'FAILED', 'RETRYABLE_ERROR'].includes(record.status)) record.completed_at = new Date();
  await record.save();
  return record;
};

module.exports = { enabled, normalizeComplyCube, normalizeCobaltTin, normalizeCobaltSos, startComplyCubeSsnCheck, startCoordinatorComplyCubeSsnCheck, startMarketplaceVendorComplyCubeSsnCheck, startCobaltEinChecks, startCoordinatorCobaltEinChecks, startMarketplaceVendorCobaltEinChecks, pollPendingCobaltSosChecks, applyProviderResult, applyCoordinatorProviderResult, applyMarketplaceVendorProviderResult };
