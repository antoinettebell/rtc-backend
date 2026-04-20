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

exports.parseDynamicAddress= async (data) => {
  console.log("getaddressData",data);
  let { title='',address = '', lat = null, long = null,zipcode=null } = data;

  if (!address) {
    return { city: null, region: null, postalCode: zipcode, country: null, latitude: lat, longitude: long };
  }

  const parts = address.split(',').map(p => p.trim());
  let city = null;
  let region = null;
  let country = null;

  if (parts.length === 0) {
    return { city, region, postalCode:zipcode, country: 'US', latitude: lat, longitude: long };
  }

  // Last part is country
  country = parts[parts.length - 1] || 'US';

  // Check if second last part has region + postal code
  const secondLast = parts[parts.length - 2] || '';
  const stateZipMatch = secondLast.match(/^([A-Za-z\s]+)\s?(\d{5,6})?$/); 
  if (stateZipMatch) {
    region = stateZipMatch[1].trim();
    zipcode = stateZipMatch[2] || zipcode;
  }

  // City fallback: part before region/postal
  city = parts[parts.length - 3] || null;

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




