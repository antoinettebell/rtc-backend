const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const FIREBASE_PROJECTS = {
  CUSTOMER: {
    appName: 'rtc-customer-push',
    credentialPathEnv: 'FIREBASE_CUSTOMER_SERVICE_ACCOUNT_PATH',
  },
  VENDOR: {
    appName: 'rtc-vendor-push',
    credentialPathEnv: 'FIREBASE_VENDOR_SERVICE_ACCOUNT_PATH',
  },
};

const STALE_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const resolveFirebaseProjectForUserType = (userType) => {
  if (userType === 'CUSTOMER') return 'CUSTOMER';
  if (userType === 'VENDOR' || userType === 'EMPLOYEE') return 'VENDOR';
  return null;
};

const isStaleTokenError = (error) =>
  STALE_TOKEN_ERROR_CODES.has(error?.code);

const getExistingApp = (appName) =>
  admin.apps.find((app) => app?.name === appName) || null;

const getFirebaseApp = (projectKey) => {
  const project = FIREBASE_PROJECTS[projectKey];
  if (!project) {
    const error = new Error('No Firebase project is configured for this recipient type.');
    error.code = 'messaging/unsupported-recipient-type';
    throw error;
  }

  const existingApp = getExistingApp(project.appName);
  if (existingApp) return existingApp;

  const credentialPath = process.env[project.credentialPathEnv];
  if (!credentialPath) {
    const error = new Error(
      `Missing ${project.credentialPathEnv} environment variable.`
    );
    error.code = 'messaging/credentials-not-configured';
    throw error;
  }

  const resolvedPath = path.resolve(credentialPath);
  if (!fs.existsSync(resolvedPath)) {
    const error = new Error('Configured Firebase service-account file was not found.');
    error.code = 'messaging/credentials-not-found';
    throw error;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (cause) {
    const error = new Error('Configured Firebase service-account file is invalid.');
    error.code = 'messaging/credentials-invalid';
    error.cause = cause;
    throw error;
  }

  return admin.initializeApp(
    { credential: admin.credential.cert(serviceAccount) },
    project.appName
  );
};

exports.resolveFirebaseProjectForUserType = resolveFirebaseProjectForUserType;
exports.isStaleTokenError = isStaleTokenError;

exports.sendNotification = async (
  title,
  body,
  data,
  userFCMToken,
  userType
) => {
  const projectKey = resolveFirebaseProjectForUserType(userType);
  const firebaseApp = getFirebaseApp(projectKey);
  return firebaseApp.messaging().send({
    notification: { title, body },
    data,
    token: userFCMToken,
  });
};
