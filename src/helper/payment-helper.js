// paymentsHelper.js
const { APIContracts, APIControllers } = require("authorizenet");
const { authorizenet } = require("../config");
var SDKConstants = require("authorizenet").Constants;
const env =  authorizenet.PAYMENT_MODE;
// const env =  'dev';

// ------------------------------
// COMMON: AUTHENTICATION
// ------------------------------
function getAuth() {
  const auth = new APIContracts.MerchantAuthenticationType();
  auth.setName(authorizenet.API_LOGIN_ID);
  auth.setTransactionKey(authorizenet.TRANSACTION_KEY);
  return auth;
}

exports.chargePaymentUnified = async (requestData) => {
  try {
    let {
  opaqueToken,
  amount,
  taxAmount = 0,
  subTotal = 0,
  paymentMethod,
  firstName = "",
  lastName = "",
  email = "",
  userId,
}=requestData
    const auth = getAuth();
    const isProduction = env !== "dev";
    userId=String(userId)
    
    // BUILD OPAQUE TOKEN

    const opaqueData = new APIContracts.OpaqueDataType();
    opaqueData.setDataValue(opaqueToken);
    opaqueData.setDataDescriptor(
      paymentMethod === "GOOGLE_PAY"
        ? "COMMON.GOOGLE.INAPP.PAYMENT"
        : paymentMethod === "APPLE_PAY"
          ? "COMMON.APPLE.INAPP.PAYMENT"
          : "COMMON.ACCEPT.INAPP.PAYMENT"
    );

    const paymentType = new APIContracts.PaymentType();
    paymentType.setOpaqueData(opaqueData);

    
    // BILL TO (NAME + EMAIL)
  
    const billTo = new APIContracts.CustomerAddressType();
    billTo.setFirstName(firstName || "User");
    billTo.setLastName(lastName || userId);
    billTo.setEmail(email || `${userId}@example.com`);

   
    // TRANSACTION REQUEST

    const txnRequest = new APIContracts.TransactionRequestType();
    txnRequest.setTransactionType(
      APIContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION
    );
    txnRequest.setAmount(amount);
    txnRequest.setPayment(paymentType);
    txnRequest.setBillTo(billTo);

    // TAX
    if (taxAmount > 0) {
      const tax = new APIContracts.ExtendedAmountType();
      tax.setAmount(parseFloat(taxAmount).toFixed(2));
      tax.setName("Tax Amount");
      txnRequest.setTax(tax);
    }

    // ORDER DETAILS
    const invoiceNumber = "INV-" + Date.now();

    const order = new APIContracts.OrderType();
    order.setInvoiceNumber(invoiceNumber);
    order.setDescription(`Wallet payment by user ${userId}`);
    txnRequest.setOrder(order);

    // OPTIONAL — RECORD useful info
    const userFields = new APIContracts.TransactionRequestType.UserFields();
    const userField1 = new APIContracts.UserField();
    userField1.setName("userId");
    userField1.setValue(String(userId));

    const userField2 = new APIContracts.UserField();
    userField2.setName("paymentSource");
    userField2.setValue(paymentMethod);

    userFields.setUserField([userField1, userField2]);
    txnRequest.setUserFields(userFields);

    // -------------------------------------------------------
    // WRAP CONTROLLER
    // -------------------------------------------------------
    const request = new APIContracts.CreateTransactionRequest();
    request.setMerchantAuthentication(auth);
    request.setTransactionRequest(txnRequest);

    const ctrl = new APIControllers.CreateTransactionController(
      request.getJSON()
    );

    ctrl.setEnvironment(
      isProduction
        ? SDKConstants.endpoint.production
        : SDKConstants.endpoint.sandbox
    );

    const response = await new Promise((resolve) =>
      ctrl.execute(() =>
        resolve(
          new APIContracts.CreateTransactionResponse(ctrl.getResponse())
        )
      )
    );

    // -------------------------------------------------------
    // MESSAGE BLOCK HANDLING (API level)
    // -------------------------------------------------------
    const msg = response.getMessages();
    const txn = response.getTransactionResponse();

    console.log("Request => ",JSON.stringify(request.getJSON(), null, 2))
    console.log("CreateTransactionController  => ",JSON.stringify(response, null, 2))

    if (!msg || msg.getResultCode() !== "Ok") {
      const err = msg?.getMessage?.()[0];

      return {
        success: false,
        env: isProduction ? "production" : "sandbox",
        level: "API_ERROR",
        code: err?.getCode() || "UNKNOWN",
        message: err?.getText() || "API returned error",
        transactionId: txn?.getTransId?.() || null,
        invoiceNumber:null,
        fullResponse: response,
      };
    }

    // -------------------------------------------------------
    // TRANSACTION BLOCK HANDLING (Processor / Bank level)
    // -------------------------------------------------------
    if (!txn || txn.getResponseCode() !== "1") {
      const errorObj =
        txn?.getErrors?.()?.getError?.()[0] ||
        msg?.getMessage?.()[0] ||
        {};

      return {
        success: false,
        env: isProduction ? "production" : "sandbox",
        level: "TRANSACTION_ERROR",
        code: errorObj?.getErrorCode?.() || errorObj?.getCode() || "TXN_ERR",
        message:
          errorObj?.getErrorText?.() ||
          errorObj?.getText?.() ||
          "Transaction failed",
        transactionId: txn?.getTransId?.() || null,
        authCode: txn?.getAuthCode?.() || null,
        avs: txn?.getAvsResultCode?.() || null,
        cvv: txn?.getCvvResultCode?.() || null,
        cavv: txn?.getCavvResultCode?.() || null,
        invoiceNumber:invoiceNumber,
        accountNumber: txn?.getAccountNumber?.() || null,
        accountType: txn?.getAccountType?.() || null,
        fullResponse: txn,
      };
    }

    // -------------------------------------------------------
    // SUCCESS RESPONSE
    // -------------------------------------------------------
    return {
      success: true,
      env: isProduction ? "production" : "sandbox",
      level: "SUCCESS",
      message: "Payment successful",
      transactionId: txn.getTransId(),
      authCode: txn.getAuthCode(),
      accountNumber: txn.getAccountNumber?.(),
      accountType: txn.getAccountType?.(),
      responseCode: txn.getResponseCode(),
      invoiceNumber:invoiceNumber,
      avs: txn.getAvsResultCode(),
      cvv: txn.getCvvResultCode(),
      cavv: txn.getCavvResultCode(),
      amount,
      taxAmount,
      subTotal,
      customer: {
        id: userId,
        firstName,
        lastName,
        email,
      },
      fullResponse: txn,
    };
  } catch (err) {
    return {
      success: false,
      level: "SERVER_EXCEPTION",
      message: err.message || "Unhandled server error",
    };
  }
};


// ------------------------------
// COMMON: HANDLE RESPONSE
// ------------------------------
function buildError(response) {
  let code = "";
  let text = "Unknown error occurred";

  try {console.log(response.getMessages());
    const msg = response.getMessages().getMessage()[0];
    code = msg.getCode();
    text = msg.getText();
  } catch {}  

  return { success: false, code, message: text };
}

function success(data) {
  return { success: true, data };
}
exports.refundPaymentUnified = async ({ transactionId, amount }) => {
  try {
    const auth = getAuth();
    const isProduction = env !== "dev";

    const original = await this.getTransactionStatus(transactionId);

    const { last4, exp } = original;

    const txnRequest = new APIContracts.TransactionRequestType();
    txnRequest.setTransactionType(APIContracts.TransactionTypeEnum.REFUNDTRANSACTION);
    txnRequest.setRefTransId(transactionId);
    txnRequest.setAmount(amount);

    // ⭐ ALWAYS USE CreditCardType EVEN FOR APPLE & GOOGLE PAY ⭐
    const card = new APIContracts.CreditCardType();
    card.setCardNumber(last4);        // "XXXX6508"
    card.setExpirationDate(exp);      // "XXXX"

    const paymentType = new APIContracts.PaymentType();
    paymentType.setCreditCard(card);

    txnRequest.setPayment(paymentType);

    const request = new APIContracts.CreateTransactionRequest();
    request.setMerchantAuthentication(auth);
    request.setTransactionRequest(txnRequest);

    const ctrl = new APIControllers.CreateTransactionController(request.getJSON());
    ctrl.setEnvironment(isProduction ? SDKConstants.endpoint.production : SDKConstants.endpoint.sandbox);

    const response = await new Promise(resolve => {
      ctrl.execute(() =>
        resolve(new APIContracts.CreateTransactionResponse(ctrl.getResponse()))
      );
    });

      const msg = response.getMessages();
      const txn = response.getTransactionResponse();

      if (!msg || msg.getResultCode() !== "Ok") {
      const err = msg?.getMessage?.()[0];
      console.log('err: ', err);
      return {
        success: false,
        env: isProduction ? "production" : "sandbox",
        level: "API_ERROR",
        code: err?.getCode() || "UNKNOWN",
        message: err?.getText() || "API returned error",
        refundTransactionId: txn?.getTransId?.() || null,
        originalTransactionId: transactionId,
        amount,
        fullResponse: txn,
      };
    }

    // Handle transaction level errors
    if (!txn || txn.getResponseCode() !== "1") {
      const errorObj = txn?.getErrors?.()?.getError?.()?.[0] || msg?.getMessage?.()?.[0] || {};
      return {
        success: false,
        env: isProduction ? "production" : "sandbox",
        level: "TRANSACTION_ERROR",
        amount,
        code: errorObj?.getErrorCode?.() || errorObj?.getCode() || "TXN_ERR",
        message: errorObj?.getErrorText?.() || errorObj?.getText?.() || "Refund failed",
        refundTransactionId: txn?.getTransId?.() || null,
        fullResponse: txn,
        transactionId: txn?.getTransId?.() || null,
        authCode: txn?.getAuthCode?.() || null,
        avs: txn?.getAvsResultCode?.() || null,
        cvv: txn?.getCvvResultCode?.() || null,
        cavv: txn?.getCavvResultCode?.() || null,
        originalTransactionId: transactionId,
        accountNumber: txn?.getAccountNumber?.() || null,
        accountType: txn?.getAccountType?.() || null,
      };
    }

    // Success response
    return {
      success: true,
      env: isProduction ? "production" : "sandbox",
      level: "SUCCESS",
      message: "Refund successful",
      refundTransactionId: txn.getTransId(),
      authCode: txn.getAuthCode?.(),
      responseCode: txn.getResponseCode(),
      amount,
      originalTransactionId: transactionId,
      accountNumber: txn.getAccountNumber?.(),
      accountType: txn.getAccountType?.(),
      responseCode: txn.getResponseCode(),
      avs: txn.getAvsResultCode(),
      cvv: txn.getCvvResultCode(),
      cavv: txn.getCavvResultCode(),
      fullResponse: txn,
    };


  } catch (err) {
     return {
      success: false,
      level: "SERVER_EXCEPTION",
      message: err.message || "Unhandled server error",
    };
  }
};

// exports.refundPaymentUnified = async ({
//   transactionId,
//   amount
// }) => {
//   try {
//     const auth = getAuth();
//     const isProduction = env !== "dev";

//     const txnRequest = new APIContracts.TransactionRequestType();
//     txnRequest.setTransactionType(APIContracts.TransactionTypeEnum.REFUNDTRANSACTION);
//     txnRequest.setRefTransId(transactionId);
//     txnRequest.setAmount(amount);

//     const request = new APIContracts.CreateTransactionRequest();
//     request.setMerchantAuthentication(auth);
//     request.setTransactionRequest(txnRequest);

//     const ctrl = new APIControllers.CreateTransactionController(request.getJSON());
//     ctrl.setEnvironment(isProduction ? SDKConstants.endpoint.production : SDKConstants.endpoint.sandbox);

//     const response = await new Promise(resolve => {
//       ctrl.execute(() => resolve(new APIContracts.CreateTransactionResponse(ctrl.getResponse())));
//     });
//     console.log("Is refundPaymentUnified  Main functions response",response);

//     // Handle API level errors
//     const msg = response.getMessages();
//     const txn = response.getTransactionResponse();

//     if (!msg || msg.getResultCode() !== "Ok") {
//       const err = msg?.getMessage?.()[0];
//       return {
//         success: false,
//         env: isProduction ? "production" : "sandbox",
//         level: "API_ERROR",
//         code: err?.getCode() || "UNKNOWN",
//         message: err?.getText() || "API returned error",
//         refundTransactionId: txn?.getTransId?.() || null,
//         fullResponse: txn,
//       };
//     }

//     // Handle transaction level errors
//     if (!txn || txn.getResponseCode() !== "1") {
//       const errorObj = txn?.getErrors?.()?.getError?.()?.[0] || msg?.getMessage?.()?.[0] || {};
//       return {
//         success: false,
//         env: isProduction ? "production" : "sandbox",
//         level: "TRANSACTION_ERROR",
//         code: errorObj?.getErrorCode?.() || errorObj?.getCode() || "TXN_ERR",
//         message: errorObj?.getErrorText?.() || errorObj?.getText?.() || "Refund failed",
//         refundTransactionId: txn?.getTransId?.() || null,
//         authCode: txn?.getAuthCode?.() || null,
//         fullResponse: txn,
//       };
//     }

//     // Success response
//     return {
//       success: true,
//       env: isProduction ? "production" : "sandbox",
//       level: "SUCCESS",
//       message: "Refund successful",
//       mode: isProduction ? "production-refund" : "sandbox-refund",
//       refundTransactionId: txn.getTransId(),
//       authCode: txn.getAuthCode?.(),
//       responseCode: txn.getResponseCode(),
//       amount,
//       originalTransactionId: transactionId,
//       refundDateTime: new Date().toISOString(),
//       fullResponse: txn,
//     };

//   } catch (err) {
//     return {
//       success: false,
//       level: "SERVER_EXCEPTION",
//       message: err.message || "Unhandled server error",
//     };
//   }
// };
exports.getTransactionStatus = async (transactionId) => {
  const auth = getAuth();

  const request = new APIContracts.GetTransactionDetailsRequest();
  request.setMerchantAuthentication(auth);
  request.setTransId(transactionId);

  const ctrl = new APIControllers.GetTransactionDetailsController(request.getJSON());
  ctrl.setEnvironment(env === "dev" ? SDKConstants.endpoint.sandbox : SDKConstants.endpoint.production);

  const response = await new Promise(resolve => {
    ctrl.execute(() =>
      resolve(new APIContracts.GetTransactionDetailsResponse(ctrl.getResponse()))
    );
  });

  const txn = response.getTransaction();
  const payment = txn?.getPayment?.();

  let last4 = "XXXX";
  let exp = "XXXX";
  let paymentMode = "card";

  // Normal card payment
  if (payment?.getCreditCard?.()) {
    last4 = payment.getCreditCard().getCardNumber() || "XXXX";
    exp = payment.getCreditCard().getExpirationDate() || "XXXX";
    paymentMode = "card";
  }

  // Apple Pay / Google Pay token
  else if (payment?.getTokenInformation?.()) {
    const token = payment.getTokenInformation();
    last4 = token.getTokenNumber() || "XXXX";        // token last4
    exp = token.getExpirationDate() || "XXXX";       // token exp
    paymentMode = token.getTokenSource()?.includes("Apple") 
      ? "apple_pay" 
      : "google_pay";
  }

  return {
    responseCode: txn?.getResponseCode(),
    transStatus: txn?.getTransactionStatus() || "",
    last4,
    exp,
    paymentMode,
    txnData: txn
  };
  // const txn = response.getTransaction();
  // const last4 = txn?.getPayment?.()?.getCreditCard?.()?.getCardNumber?.() || "XXXX";
  // console.log('txn?.getPayment?.()?.getCreditCard?.()?.getCardNumber?.(): ', txn?.getPayment?.()?.getCreditCard?.()?.getCardNumber?.());
  // console.log('txn?.getPayment?.()?.getCreditCard?.(): ', txn?.getPayment?.()?.getCreditCard?.());
  // console.log('txn?.getPayment?.(): ', txn?.getPayment?.());

  // return {
  //   responseCode: txn?.getResponseCode(),
  //   transStatus: txn?.getTransactionStatus(),
  //   last4,
  //   exp: txn?.getPayment?.()?.getCreditCard?.()?.getExpirationDate?.() || "XXXX",
  //   txnData:txn
  // };  
};
exports.voidTransaction = async (transactionId) => {
  try {
    const auth = getAuth();
    const isProduction = env !== "dev";

    const txnRequest = new APIContracts.TransactionRequestType();
    txnRequest.setTransactionType("voidTransaction");
    txnRequest.setRefTransId(transactionId);

    const request = new APIContracts.CreateTransactionRequest();
    request.setMerchantAuthentication(auth);
    request.setTransactionRequest(txnRequest);

    const ctrl = new APIControllers.CreateTransactionController(request.getJSON());
    ctrl.setEnvironment(isProduction ? SDKConstants.endpoint.production : SDKConstants.endpoint.sandbox);

    const response = await new Promise(resolve => {
      ctrl.execute(() =>
        resolve(new APIContracts.CreateTransactionResponse(ctrl.getResponse()))
      );
    });

    // Handle API level errors
    const msg = response.getMessages();
    console.log('msg: ', msg);
    const txn = response.getTransactionResponse();
    console.log('void txn: ', txn);

    if (!msg || msg.getResultCode() !== "Ok") {
      const err = msg?.getMessage?.()[0];
      console.log('err: ', err);
      return {
        success: false,
        env: isProduction ? "production" : "sandbox",
        level: "API_ERROR",
        code: err?.getCode() || "UNKNOWN",
        message: err?.getText() || "API returned error",
        refundTransactionId: txn?.getTransId?.() || null,
        originalTransactionId: transactionId,
        fullResponse: response,
      };
    }

    // Handle transaction level errors
    if (!txn || txn.getResponseCode() !== "1") {
      const errorObj = txn?.getErrors?.()?.getError?.()?.[0] || msg?.getMessage?.()?.[0] || {};
      console.log('errorObj: ', errorObj);
      return {
        success: false,
        env: isProduction ? "production" : "sandbox",
        level: "TRANSACTION_ERROR",
        code: errorObj?.getErrorCode?.() || errorObj?.getCode() || "TXN_ERR",
        message: errorObj?.getErrorText?.() || errorObj?.getText?.() || "Void transaction failed",
        refundTransactionId: txn?.getTransId?.() || null,
        originalTransactionId: transactionId,
        authCode: txn?.getAuthCode?.() || null,
        fullResponse: txn,
      };
    }

    // Success response
    return {
      success: true,
      env: isProduction ? "production" : "sandbox",
      level: "SUCCESS",
      message: "Void successful",
      refundTransactionId: txn.getTransId(),
      authCode: txn.getAuthCode?.(),
      responseCode: txn.getResponseCode(),
      originalTransactionId: transactionId,
      accountNumber: txn.getAccountNumber?.(),
      accountType: txn.getAccountType?.(),
      avs: txn.getAvsResultCode(),
      cvv: txn.getCvvResultCode(),
      cavv: txn.getCavvResultCode(),
      fullResponse: txn,
    };

  } catch (err) {
    return {
      success: false,
      level: "SERVER_EXCEPTION",
      message: err.message || "Unhandled server error",
    };
  }
};


exports.processRefund = async ({
  transactionId,
  amount
}) => {
  try {
    // -----------------------------------
    // 1️⃣ CHECK TRANSACTION STATUS FIRST
    // -----------------------------------
    const status = await this.getTransactionStatus(transactionId);

    // Check if transaction not found
    if (!status.txnData) {
      return {
        success: false,
        level: "TRANSACTION_NOT_FOUND",
        message: "Transaction not found",
        originalTransactionId: transactionId,
        amount,
        skipLog: true
      };
    }

    const transStatus = status.transStatus?.toLowerCase() || "";
    
    // Check if already voided
    if (transStatus.includes("voided")) {
      return {
        success: false,
        level: "VOIDED_ERROR",
        message: "Transaction already voided",
        originalTransactionId: transactionId,
        amount,
        skipLog: true
      };
    }

    const isSettled =
    transStatus === "settledsuccessfully" ||
    (transStatus.includes("settled") && !transStatus.includes("pending"));
    // -----------------------------------
    // 2️⃣ IF NOT SETTLED → VOID
    // -----------------------------------
    if (!isSettled ) {
      const voidResp = await this.voidTransaction(transactionId);
      return {
        ...voidResp,
        mode: 'void',
        amount,
      };
    }

    // -----------------------------------
    // 3️⃣ IF SETTLED → REFUND
    // -----------------------------------
    const refundResp = await this.refundPaymentUnified({
      transactionId,
      amount,
    });
    return {
      ...refundResp,
      mode: 'refund',
    };

  } catch (err) {
    return {
      success: false,
      level: "SERVER_EXCEPTION",
      message: err.message || "Unhandled server error",
      originalTransactionId: transactionId,
      amount
    };
  }
};




