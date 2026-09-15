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

exports.listChecklistTasks = async (req, res, next) => {
  try {
    const tasks = await Service.listChecklistTasks({
      user: req.user,
      type: req.params.type,
    });
    return res.data({ tasks }, 'Operational checklist tasks');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.createChecklistTask = async (req, res, next) => {
  try {
    const task = await Service.createChecklistTask({ user: req.user, payload: req.body });
    return res.data({ task }, 'Operational checklist task created');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.archiveChecklistTask = async (req, res, next) => {
  try {
    const task = await Service.archiveChecklistTask({
      user: req.user,
      taskId: req.params.taskId,
    });
    return res.data({ task }, 'Operational checklist task archived');
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

exports.createInventoryItem = async (req, res, next) => {
  try {
    const result = await Service.createInventoryItem({ user: req.user, payload: req.body });
    return res.data(result, 'Inventory item created');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.updateInventoryItem = async (req, res, next) => {
  try {
    const result = await Service.updateInventoryItem({
      user: req.user,
      id: req.params.id,
      itemId: req.params.itemId,
      payload: req.body,
      submit: false,
    });
    return res.data(result, 'Inventory draft saved');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.submitInventoryItem = async (req, res, next) => {
  try {
    const result = await Service.updateInventoryItem({
      user: req.user,
      id: req.params.id,
      itemId: req.params.itemId,
      payload: req.body,
      submit: true,
    });
    return res.data(result, 'Inventory item submitted');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.closeInventoryCount = async (req, res, next) => {
  try {
    const result = await Service.closeInventoryCount({
      user: req.user,
      id: req.params.id,
      itemId: req.params.itemId,
      payload: req.body,
    });
    return res.data(result, 'Inventory count closed');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.archiveInventoryItem = async (req, res, next) => {
  try {
    const result = await Service.archiveInventoryItem({
      user: req.user,
      id: req.params.id,
      itemId: req.params.itemId,
    });
    return res.data(result, 'Inventory item archived');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.discardEmployeeInventoryDraft = async (req, res, next) => {
  try {
    const result = await Service.discardEmployeeInventoryDraft({
      user: req.user,
      id: req.params.id,
    });
    return res.data(result, 'Employee inventory draft discarded');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};

exports.reviewEmployeeInventory = async (req, res, next) => {
  try {
    const result = await Service.reviewEmployeeInventory({
      user: req.user,
      id: req.params.id,
      payload: req.body,
    });
    return res.data(result, 'Employee inventory reviewed');
  } catch (error) {
    return handleOperationalError(req, error, next);
  }
};
