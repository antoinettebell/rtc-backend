const { avalaratax } = require('../config');
const axios = require('axios');

exports.calculateAvalaraTax = async (data) => {
  try {
    const {
      shipFrom,
      shipTo,
      amount = 0,
      taxCode = 'PF040000',
      description = '',
    } = data;

    // ✅ Base payload (common for all requests)
    const payload = {
      type: 'SalesOrder',
      companyCode: 'ROUNDTHECORNER',
      date: new Date().toISOString().split('T')[0],
      customerCode: 'ROUNDTHECORNER-Customer',
      commit: false,
      currencyCode: 'USD',
      addresses: {
        shipFrom:shipFrom,
        shipTo:shipTo,
      },
      lines: [
        {
          number: '1',
          quantity: 1,
          amount,
          taxCode,
          description,
        },
      ],
    };
   console.log("payload",payload);
    // ✅ Auth setup
    const username = avalaratax.AVALARA_USERNAME;
    const password = avalaratax.AVALARA_PASSWORD;
    const clientHeader = avalaratax.AVALARA_CLIENT_HEADER;
    const baseURL = avalaratax.AVALARA_URL;

    const base64Credentials = Buffer.from(`${username}:${password}`).toString('base64');
    const TRANSACTION_AVALARA_URL = `${baseURL}transactions/create`;

    // ✅ API call
    const response = await axios.post(TRANSACTION_AVALARA_URL, payload, {
      headers: {
        'X-Avalara-Client': clientHeader || 'NodeJS-App',
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/json',
      },
    });

    const responseData = response.data;

    return {
      success: true,
      totalTax: responseData.totalTax || 0,
      data: responseData,
    };
  } catch (error) {
    console.error('❌ Avalara Tax Error:', error.response?.data || error.message);

    return {
      success: false,
      message: error.response?.data?.error?.message || 'Tax calculation failed',
    };
  }
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

const normalizeCountry = (value) => {
  const normalized = String(value || '').trim().toUpperCase();

  if (['US', 'USA', 'U.S.', 'U.S.A.', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(normalized)) {
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

exports.parseDynamicAddress= async (data) => {
  console.log("getaddressData",data);
  let { title='',address = '', lat = null, long = null,zipcode=null } = data;

  if (!address) {
    return { city: null, region: null, postalCode: zipcode, country: 'US', latitude: lat, longitude: long };
  }

  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  let city = null;
  let region = null;
  let country = 'US';

  if (parts.length === 0) {
    return { city, region, postalCode:zipcode, country: 'US', latitude: lat, longitude: long };
  }

  const explicitCountry = normalizeCountry(parts[parts.length - 1]);
  if (explicitCountry) {
    country = explicitCountry;
    parts.pop();
  }

  if (parts.length === 1) {
    const shortAddressMatch = parts[0].match(/^(.*?)\s+([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);

    if (shortAddressMatch && US_STATE_CODES.has(shortAddressMatch[2].toUpperCase())) {
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

  return {
    lines:title||'',
    city: city || null,
    region: region || null,
    postalCode: zipcode || null,
    country: country || 'US',
    latitude: lat,
    longitude: long
  };
};


