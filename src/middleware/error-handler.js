const expressValidation = require('express-validation');
const { Error } = require('../utils/api-response');
const DELETE_STACK = true;

/**
 * Error handler. Send stacktrace only during development
 * @public
 */
// eslint-disable-next-line no-unused-vars
exports.handler = (err, req, res, next) => {
  const statusCode = Number(err.status || err.code || 500);
  const response = {
    success: false,
    code: statusCode >= 100 && statusCode < 600 ? statusCode : 500,
    error: err.error,
    message: err.message,
    stack: err.stack,
    data: err.data || (err.compliance ? { compliance: err.compliance } : null),
  };

  if (DELETE_STACK) {
    delete response.stack;
  }
  return res.status(response.code).json(response);
};

/**
 * If error is not an instanceOf {Error}, convert it.
 * @public
 */
exports.converter = (err, req, res, next) => {
  let convertedError = err;

  if (err instanceof expressValidation.ValidationError) {
    let customMsg = '';

    const methods = Object.keys(err.details);

    methods.forEach((m) => {
      err.details[m].forEach((element) => {
        customMsg += `${element.path.join('.')}, `;
      });
    });

    customMsg = customMsg.substring(0, customMsg.length - 2);
    convertedError = new Error({
      success: false,
      error: err.details,
      message: `Please enter valid ${customMsg}`,
      stack: err.stack,
      status: 400,
    });
  } else if (!(err instanceof Error)) {
    convertedError = new Error({
      success: false,
      message: err.message,
      stack: err.stack,
      status: err.status || err.code || 500,
      data: err.data || (err.compliance ? { compliance: err.compliance } : null),
    });
  }

  return this.handler(convertedError, req, res);
};

/**
 * Catch 404 and forward to error handler
 * @public
 */
exports.notFound = (req, res) => {
  const err = new Error('Not found');
  err.code = 404;
  return this.handler(err, req, res);
};
