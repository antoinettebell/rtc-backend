const Service = require('../services/operational-compliance-form-service');

const handleOperationalError = (req, error, next) => {
  console.error('Operational compliance request failed', {
    route: req.originalUrl,
    form_id: req.params?.id || null,
    form_type: req.params?.type || req.body?.form_type || null,
    employee_internal_id: req.user?.employee_internal_id || null,
    employee_session_id: req.user?.employee_session_id || null,
    truck_unit_id: req.user?.assigned_truck_unit_id || null,
    location_id: req.user?.assigned_location_id || null,
    error_name: error?.name,
    error_message: error?.message,
  });
  if (!error.code && error?.name === 'ValidationError') {
    error.code = 422;
    error.message = `Invalid operations form: ${error.message}`;
  }
  if (!error.code && error?.name === 'CastError') {
    error.code = 400;
    error.message = 'The operations form identifier is invalid.';
  }
  return next(error);
};

exports.list = async (req, res, next) => {
  try {
    const forms = await Service.list({
      user: req.user,
      type: req.query.type,
      status: req.query.status,
    });
    const truckUnits = await Service.getTruckUnits(req.user);
    return res.data({ forms, truckUnits }, 'Operational compliance forms');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.current = async (req, res, next) => {
  try {
    const form = await Service.getOrCreateDraft({
      user: req.user,
      type: req.params.type,
    });
    const truckUnits = await Service.getTruckUnits(req.user);
    return res.data({ form, truckUnits }, 'Current operational compliance form');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.update = async (req, res, next) => {
  try {
    const form = await Service.update({
      user: req.user,
      id: req.params.id,
      payload: req.body,
    });
    return res.data({ form }, 'Operational compliance form saved');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.submit = async (req, res, next) => {
  try {
    const form = await Service.submit({
      user: req.user,
      id: req.params.id,
      payload: req.body,
    });
    return res.data({ form }, 'Operational compliance form submitted');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.unlock = async (req, res, next) => {
  try {
    const form = await Service.unlock({ user: req.user, id: req.params.id });
    return res.data({ form }, 'Operational compliance form unlocked');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.archive = async (req, res, next) => {
  try {
    const result = await Service.archive({ user: req.user, id: req.params.id });
    return res.data(result, 'Operational compliance form archived');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};
