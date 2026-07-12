const { avalaratax } = require('../config');
const axios = require('axios');

const TAX_CODES = {
  PREPARED_FOOD: 'FR020100',
  DELIVERY_FEE: 'FR010100',
  PLATFORM_SERVICE_FEE: 'OU040300',
};

const US_STATE_CODES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'IA',
  'ID',
  'IL',
  'IN',
  'KS',
  'KY',
  'LA',
  'MA',
  'MD',
  'ME',
  'MI',
  'MN',
  'MO',
  'MS',
  'MT',
  'NC',
  'ND',
  'NE',
  'NH',
  'NJ',
  'NM',
  'NV',
  'NY',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VA',
  'VT',
  'WA',
  'WI',
  'WV',
  'WY',
  'DC',
]);

const toMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(Math.max(0, amount).toFixed(2)) : 0;
};

const LOW_VALUE_AVALARA_THRESHOLD = 0.1;

const getToday = () => new Date().toISOString().split('T')[0];

const normalizeCountry = (value) => {
  const normalized = String(value || '').trim().toUpperCase();

  if (
    [
      'US',
      'USA',
      'U.S.',
      'U.S.A.',
      'UNITED STATES',
      'UNITED STATES OF AMERICA',
    ].includes(normalized)
  ) {
    return 'US';
  }

  return null;
};

const parseRegionPostal = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/\b([A-Za-z]{2})\b(?:\s+(\d{5}(?:-\d{4})?))?$/);

  if (!match) {
    return { region: null, postalCode: null };
  }

  const region = match[1].toUpperCase();

  if (!US_STATE_CODES.has(region)) {
    return { region: null, postalCode: null };
  }

  return {
    region,
    postalCode: match[2] || null,
  };
};

const cleanAddress = (address) => ({
  line1: address?.line1 || null,
  city: address?.city || null,
  region: address?.region || null,
  postalCode: address?.postalCode || null,
  country: address?.country || 'US',
  latitude: address?.latitude || null,
  longitude: address?.longitude || null,
});

const buildMarketplaceLines = ({
  foodAmount = 0,
  deliveryFee = 0,
  serviceFee = 0,
}) => {
  const lines = [];
  const preparedFoodAmount = toMoney(foodAmount);
  const deliveryAmount = toMoney(deliveryFee);
  const serviceAmount = toMoney(serviceFee);

  if (preparedFoodAmount > 0) {
    lines.push({
      number: String(lines.length + 1),
      quantity: 1,
      amount: preparedFoodAmount,
      taxCode: TAX_CODES.PREPARED_FOOD,
      description: 'Prepared Restaurant Food',
    });
  }

  if (serviceAmount > 0) {
    lines.push({
      number: String(lines.length + 1),
      quantity: 1,
      amount: serviceAmount,
      taxCode: TAX_CODES.PLATFORM_SERVICE_FEE,
      description: 'Platform Service Fee',
    });
  }

  if (deliveryAmount > 0) {
    lines.push({
      number: String(lines.length + 1),
      quantity: 1,
      amount: deliveryAmount,
      taxCode: TAX_CODES.DELIVERY_FEE,
      description: 'Delivery Charge',
    });
  }

  return lines;
};

const callAvalaraCreateTransaction = async (payload) => {
  const username = avalaratax.AVALARA_USERNAME;
  const password = avalaratax.AVALARA_PASSWORD;
  const clientHeader = avalaratax.AVALARA_CLIENT_HEADER;
  const baseURL = avalaratax.AVALARA_URL;

  const base64Credentials = Buffer.from(`${username}:${password}`).toString(
    'base64'
  );
  const transactionUrl = `${baseURL}transactions/create`;

  const response = await axios.post(transactionUrl, payload, {
    headers: {
      'X-Avalara-Client': clientHeader || 'NodeJS-App',
      Authorization: `Basic ${base64Credentials}`,
      'Content-Type': 'application/json',
    },
  });

  return response.data;
};

exports.calculateAvalaraTax = async (data) => {
  try {
    const {
      shipFrom,
      shipTo,
      amount = 0,
      taxCode = 'PF040000',
      description = '',
      lines,
      type = 'SalesOrder',
      commit = false,
      code,
      customerCode = 'ROUNDTHECORNER-Customer',
      purchaseOrderNo,
      currencyCode = 'USD',
    } = data;

    const transactionLines =
      Array.isArray(lines) && lines.length > 0
        ? lines
        : [
            {
              number: '1',
              quantity: 1,
              amount: toMoney(amount),
              taxCode,
              description,
            },
          ];

    const payload = {
      type,
      companyCode: 'ROUNDTHECORNER',
      date: getToday(),
      customerCode,
      commit,
      currencyCode,
      addresses: {
        shipFrom: cleanAddress(shipFrom),
        shipTo: cleanAddress(shipTo || shipFrom),
      },
      lines: transactionLines,
    };

    if (code) payload.code = code;
    if (purchaseOrderNo) payload.purchaseOrderNo = purchaseOrderNo;

    const responseData = await callAvalaraCreateTransaction(payload);

    return {
      success: true,
      totalTax: responseData.totalTax || 0,
      payload,
      data: responseData,
    };
  } catch (error) {
    console.error('Avalara Tax Error:', error.response?.data || error.message);

    return {
      success: false,
      message: error.response?.data?.error?.message || 'Tax calculation failed',
      data: error.response?.data || null,
    };
  }
};

exports.calculateMarketplaceFoodDeliveryTax = async ({
  shipFrom,
  shipTo,
  foodAmount = 0,
  deliveryFee = 0,
  serviceFee = 0,
  type = 'SalesOrder',
  commit = false,
  code,
  customerCode,
  purchaseOrderNo,
}) => {
  const lines = buildMarketplaceLines({ foodAmount, deliveryFee, serviceFee });
  const taxableTotal = toMoney(
    lines.reduce((total, line) => total + Number(line.amount || 0), 0)
  );

  if (lines.length === 0) {
    return {
      success: true,
      totalTax: 0,
      payload: null,
      data: null,
    };
  }

  if (taxableTotal <= LOW_VALUE_AVALARA_THRESHOLD) {
    return {
      success: true,
      totalTax: 0,
      payload: {
        skipped: true,
        reason: 'LOW_VALUE_TRANSACTION',
        threshold: LOW_VALUE_AVALARA_THRESHOLD,
        taxableTotal,
        lines,
      },
      data: null,
    };
  }

  return exports.calculateAvalaraTax({
    shipFrom,
    shipTo,
    lines,
    type,
    commit,
    code,
    customerCode,
    purchaseOrderNo,
  });
};

exports.parseDynamicAddress = async (data) => {
  let {
    title = '',
    address = '',
    lat = null,
    long = null,
    zipcode = null,
  } = data || {};

  if (!address) {
    return {
      lines: title || null,
      city: null,
      region: null,
      postalCode: zipcode,
      country: 'US',
      latitude: lat,
      longitude: long,
    };
  }

  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const originalParts = [...parts];
  let city = null;
  let region = null;
  let country = 'US';

  if (parts.length === 0) {
    return {
      lines: title || null,
      city,
      region,
      postalCode: zipcode,
      country,
      latitude: lat,
      longitude: long,
    };
  }

  const explicitCountry = normalizeCountry(parts[parts.length - 1]);
  if (explicitCountry) {
    country = explicitCountry;
    parts.pop();
  }

  if (parts.length === 1) {
    const shortAddressMatch = parts[0].match(
      /^(.*?)\s+([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/
    );

    if (
      shortAddressMatch &&
      US_STATE_CODES.has(shortAddressMatch[2].toUpperCase())
    ) {
      city = shortAddressMatch[1].trim() || null;
      region = shortAddressMatch[2].toUpperCase();
      zipcode = shortAddressMatch[3] || zipcode;
      parts.pop();
    }
  } else {
    const regionPostalPart = parts[parts.length - 1] || '';
    const parsedRegionPostal = parseRegionPostal(regionPostalPart);

    if (parsedRegionPostal.region) {
      region = parsedRegionPostal.region;
      zipcode = parsedRegionPostal.postalCode || zipcode;
      parts.pop();
    }
  }

  if (!city) {
    city = parts[parts.length - 1] || null;
  }

  const lineParts = parts.slice(0, Math.max(1, parts.length - 1));
  const line1 = lineParts.join(', ') || title || originalParts[0] || null;

  return {
    lines: line1,
    city: city || null,
    region: region || null,
    postalCode: zipcode || null,
    country,
    latitude: lat,
    longitude: long,
  };
};

exports.TAX_CODES = TAX_CODES;
