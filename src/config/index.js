/**
 *
 * @type {{mongo: {dbPort: *, dbPass: *, dbName: *, dbUser: *, dbHost: *}, server: {port: (*|number), name: (*|string), backendBaseURL: *, frontendBaseURL: *}, JWT: {secret: *}, response: {disableErrorStack: (T|boolean)}: {password: *, email: *}, env: *}}
 */
module.exports = {
  env: process.env.ENV,
  server: {
    name: process.env.SERVER_NAME || 'server',
    port: process.env.SERVER_PORT || 3000,
    backendBaseURL: process.env.SERVER_BACKEND_BASE_URL,
    frontendBaseURL: process.env.FRONTEND_BASE_URL,
  },
  JWT: {
    secret: process.env.JWT_SECRET_KEY,
  },
  mongo: {
    dbHost: process.env.DB_HOST,
    dbPort: process.env.DB_PORT,
    dbName: process.env.DB_NAME,
    dbUser: process.env.DB_USER,
    dbPass: process.env.DB_PASS,
  },
  response: {
    disableErrorStack:
      'RES_HALPER_DISABLE_ERR_STACK' in process.env
        ? process.env.RES_HALPER_DISABLE_ERR_STACK
        : true,
  },
  sendgridSetting: {
    email: process.env.SENDGRID_EMAIL,
    secret: process.env.SENDGRID_SECRET,
  },
  twilio: {
    enabled:
      process.env.TWILIO_SMS_ENABLED === undefined
        ? true
        : String(process.env.TWILIO_SMS_ENABLED).toLowerCase() === 'true',
    smsEnv: process.env.TWILIO_SMS_ENV || 'trial',
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  },
  aws: {
    s3Access: process.env.S3_ACCESS_KEY,
    s3Secret: process.env.S3_SECRET_KEY,
    s3Bucket: process.env.S3_BUCKET,
  },
  encryption: {
      secretKey: process.env.ENCRYPTION_SECRET_KEY,
    },
    avalaratax: {
      AVALARA_USERNAME: process.env.AVALARA_USERNAME,
      AVALARA_PASSWORD: process.env.AVALARA_PASSWORD,
      AVALARA_URL: process.env.AVALARA_URL,
      AVALARA_CLIENT_HEADER: process.env.AVALARA_CLIENT_HEADER
    },
    authorizenet: {
      // sandip bhai sanbox account
      // API_LOGIN_ID: "7du6kBX7x",
      // TRANSACTION_KEY: "58VZ43Crx4vhn5X9",
      // PAYMENT_MODE: "dev",

      // client sanbox account
      // API_LOGIN_ID: "6E7kL25mQEE5",
      // TRANSACTION_KEY: "77vsk23CR466Q67w",
      // PAYMENT_MODE: "dev",

      // client production account
      API_LOGIN_ID: "48TQ8Zt2pmjP",
      TRANSACTION_KEY: "2G26GAuuQv22s4K6",
      PAYMENT_MODE: "prod",
    },
    docusign: {
      enabled: String(process.env.DOCUSIGN_ENABLED || 'false').toLowerCase() === 'true',
      integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY,
      clientSecret: process.env.DOCUSIGN_CLIENT_SECRET,
      userId: process.env.DOCUSIGN_USER_ID,
      accountId: process.env.DOCUSIGN_ACCOUNT_ID,
      privateKey: process.env.DOCUSIGN_PRIVATE_KEY,
      basePath: process.env.DOCUSIGN_BASE_PATH || 'https://demo.docusign.net/restapi',
      authServer: process.env.DOCUSIGN_AUTH_SERVER || 'account-d.docusign.com',
      webhookSecret: process.env.DOCUSIGN_WEBHOOK_SECRET,
      returnUrl:
        process.env.DOCUSIGN_RETURN_URL ||
        'rounddacornervendor://docusign/return',
      signerRole:
        process.env.DOCUSIGN_SIGNER_ROLE ||
        process.env.DOCUSIGN_VENDOR_ROLE_NAME ||
        'VendorSigner',
      governanceTemplateId: process.env.DOCUSIGN_GOVERNANCE_TEMPLATE_ID,
      ndaTemplateId: process.env.DOCUSIGN_NDA_TEMPLATE_ID,
      governanceVersion: process.env.DOCUSIGN_GOVERNANCE_VERSION || '1.0',
      ndaVersion: process.env.DOCUSIGN_NDA_VERSION || '1.0',
      developerAlertEmail:
        process.env.DOCUSIGN_DEVELOPER_ALERT_EMAIL ||
        process.env.DEVELOPER_ALERT_EMAIL ||
        'developer@roundthecornerapp.com',
    },
  };

