const sgMail = require('@sendgrid/mail');
const { sendgridSetting, JWT, server } = require('../config');
const {
  OTP_VERIFICATION_TEMPLATE,
  NEW_VENDOR_TO_ADMIN,
  WELCOME_NEW_VENDOR,
  VENDOR_REQUEST_STATUS_APPROVE,
  VENDOR_REQUEST_STATUS_REJECT,
  PAYMENTS_FAILED,
  PAYMENTS_SUCCESS,

} = require('./templates');
const MailHelper = require('../helper/mail-helper');
const Utils = require('../helper/utils');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

sgMail.setApiKey(sendgridSetting.secret);

exports.sendMail = async (to, subject, html) => {
  const msg = {
    to,
    from: sendgridSetting.email, // Use the email address or domain you verified with SendGrid
    subject,
    html,
  };

  if (!sendgridSetting.email || !sendgridSetting.secret) {
    throw new Error('Feature not available');
    return;
  }
  try{
    await sgMail.send(msg);
  }catch(error){
    console.error("SendGrid Error:", error?.response?.body || error.message);
  }
};

exports.sendOTP = async (verificationType, payload, email, oldOTPs = []) => {
  let subject = '';
  let msg = '';

  if (verificationType === 'verify-email') {
    subject = 'Round The Corner email verification';
    msg =
      'To complete your verification for your Round The Corner account, please enter the OTP code provided below:';
  }

  if (verificationType === 'change-password') {
    subject = 'Change Password';
    msg =
      'To complete your password change request for your Round The Corner account, please enter the OTP code provided below:';
  }

  if (verificationType === 'delete-account') {
    subject = 'Delete My Account';
    msg =
      'To delete your Round The Corner account, please enter the OTP code provided below:';
  }

  if (!subject) {
    throw new Error('Invalid type');
  }

  const otp = Utils.generateOTP();

  const template = OTP_VERIFICATION_TEMPLATE.replaceAll(
    '####description####',
    msg
  ).replaceAll('####OTP####', otp);

  try {
    await MailHelper.sendMail(email, subject, template);
  } catch (e) {
    console.log('Mail not sent.');
    console.log('=======', e);
  }

  const newOTPs = [...oldOTPs, await bcrypt.hash(otp, 12)];

  const otpVerificationToken = await jwt.sign(
    {
      ...payload,
      verificationType,
      otp: newOTPs,
    },
    JWT.secret,
    {
      expiresIn: '3h',
    }
  );

  console.log(`===================OTP-${verificationType}`, otp);

  return otpVerificationToken;
};

exports.sendWelcomeToVendor = async (vendor) => {
  const template = WELCOME_NEW_VENDOR.replaceAll(
    '####name####',
    vendor.firstName
  );

  try {
    await MailHelper.sendMail(
      vendor.email,
      'Welcome to Round The Corner – Your Food Truck is Almost Ready to Roll! 🚚🍔',
      template
    );
  } catch (e) {
    console.log('Mail not sent.');
    console.log('=======', e);
  }

  return true;
};

exports.sendNewVendorReqToAdmin = async (vendor, foodTruck) => {
  const template = NEW_VENDOR_TO_ADMIN.replaceAll(
    '####url####',
    `${server.frontendBaseURL}/vendor/detail/?q=${vendor._id}`
  )
    .replaceAll('####name####', vendor.firstName)
    .replaceAll('####email####', vendor.email)
    .replaceAll('####ft####', foodTruck.name);

  try {
    await MailHelper.sendMail(
      'roundthecornerapp@gmail.com',
      'New vendor request',
      template
    );
  } catch (e) {
    console.log('Mail not sent.');
    console.log('=======', e);
  }

  return true;
};

exports.sendRequestStatusToVendor = async (vendor, status, reason = '') => {
  const template = (
    status === 'APPROVED'
      ? VENDOR_REQUEST_STATUS_APPROVE
      : VENDOR_REQUEST_STATUS_REJECT
  )
    .replaceAll('####name####', vendor.firstName)
    .replaceAll('####reason####', reason);

  try {
    await MailHelper.sendMail(
      vendor.email,
      status === 'APPROVED'
        ? 'Your Food Truck is Now Live on Round The Corner! 🎉'
        : 'Update on Your Round The Corner Vendor Application',
      template
    );
  } catch (e) {
    console.log('Mail not sent.');
    console.log('=======', e);
  }

  return true;
};

exports.sendPaymentsSuccessAndFailed = async (user, status, data) => {   
  let template = status === true
    ? PAYMENTS_SUCCESS
    : PAYMENTS_FAILED;

  // COMMON placeholders
  template = template
    .replaceAll('####name####', `${user.firstName} ${user.lastName || ''}`.trim())
    .replaceAll('####invoiceNumber####', data.invoiceNumber || 'N/A')
    .replaceAll('####amount####', data.amount || '0.00')
    .replaceAll('####date####', data.date || '')
    .replaceAll('####transactionId####', data.transactionId || 'N/A')
    .replaceAll('####authCode####', data.authCode || 'N/A')
    .replaceAll('####mode####', data.mode || 'N/A')
    .replaceAll('####paymentMethod####', data.paymentMethod || '')
    .replaceAll('####accountNumber####', data.accountNumber || '')
    .replaceAll('####accountType####', data.accountType || '')
    .replaceAll('####mode####', data.mode || '');


  // FAILED placeholders only
  if (!status) {
    template = template
      .replaceAll('####name####', `${user.firstName} ${user.lastName || ''}`.trim())
      .replaceAll('####errorCode####', data.errorCode || 'N/A')
      .replaceAll('####invoiceNumber####', data.invoiceNumber || 'N/A')
      .replaceAll('####amount####', data.amount || '0.00')
      .replaceAll('####date####', data.date || '')
      .replaceAll('####notes####', data.notes || 'No notes provided')
      .replaceAll('####errorMessage####', data.errorMessage || 'No Message provided')
      .replaceAll('####mode####', data.mode || '');

  }

  try {
    await MailHelper.sendMail(
      user.email,
      status ? 'Payment Successful' : 'Payment Failed',
      template
    );
  } catch (e) {
    console.log('Mail not sent.');
    console.log('=======', e);
  }

  return true;
};


