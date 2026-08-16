const CUSTOMER_IOS_APP_ID =
  '5G26GFF98P.com.rounddacorner.dev.customer';
const CUSTOMER_ANDROID_PACKAGE = 'com.rounddacorner.dev.customer';
const CUSTOMER_ANDROID_CERTIFICATES = [
  // Direct development builds.
  'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C',
  // Signed release builds produced by the repository release keystore.
  'E9:D4:C9:4B:C9:AE:E1:FA:EC:E3:9E:80:B2:BC:32:05:19:98:0E:C7:9E:44:86:F5:ED:DE:EF:C3:6B:A8:68:5F',
];

const appleAppSiteAssociation = {
  applinks: {
    apps: [],
    details: [
      {
        appID: CUSTOMER_IOS_APP_ID,
        paths: ['/events/*'],
      },
    ],
  },
};

const androidAssetLinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: CUSTOMER_ANDROID_PACKAGE,
      sha256_cert_fingerprints: CUSTOMER_ANDROID_CERTIFICATES,
    },
  },
];

const setAssociationHeaders = res => {
  res.set({
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
};

const sendAppleAppSiteAssociation = (req, res) => {
  setAssociationHeaders(res);
  return res.type('application/json').send(appleAppSiteAssociation);
};

const sendAndroidAssetLinks = (req, res) => {
  setAssociationHeaders(res);
  return res.type('application/json').send(androidAssetLinks);
};

module.exports = {
  CUSTOMER_IOS_APP_ID,
  CUSTOMER_ANDROID_PACKAGE,
  CUSTOMER_ANDROID_CERTIFICATES,
  appleAppSiteAssociation,
  androidAssetLinks,
  sendAppleAppSiteAssociation,
  sendAndroidAssetLinks,
};
