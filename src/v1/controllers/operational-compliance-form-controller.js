const Service = require('../services/operational-compliance-form-service');

exports.list = async (req, res, next) => {
  try {
    const forms = await Service.list({
      user: req.user,
      type: req.query.type,
      status: req.query.status,
    });
    return res.data({ forms }, 'Operational compliance forms');
  } catch (error) {
    return next(error);
  }
};

exports.current = async (req, res, next) => {
  try {
    const form = await Service.getOrCreateDraft({
      user: req.user,
      type: req.params.type,
    });
    return res.data({ form }, 'Current operational compliance form');
  } catch (error) {
    return next(error);
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
    return next(error);
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
    return next(error);
  }
};

exports.unlock = async (req, res, next) => {
  try {
    const form = await Service.unlock({ user: req.user, id: req.params.id });
    return res.data({ form }, 'Operational compliance form unlocked');
  } catch (error) {
    return next(error);
  }
};

exports.archive = async (req, res, next) => {
  try {
    const result = await Service.archive({ user: req.user, id: req.params.id });
    return res.data(result, 'Operational compliance form archived');
  } catch (error) {
    return next(error);
  }
};
