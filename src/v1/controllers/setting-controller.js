const { SettingService: Service } = require('../services');
const entityName = 'Setting';

exports.getTerm = async (req, res, next) => {
  try {
    const data = await Service.getByData({}, { singleResult: true });

    return res.data({ termsConditions: data?.termsConditions || null });
  } catch (e) {
    return next(e);
  }
};

exports.getPolicy = async (req, res, next) => {
  try {
    const data = await Service.getByData({}, { singleResult: true });

    return res.data({ privacyPolicy: data?.privacyPolicy || null });
  } catch (e) {
    return next(e);
  }
};

exports.getAgreement = async (req, res, next) => {
  try {
    const data = await Service.getByData({}, { singleResult: true });

    return res.data({ agreement: data?.agreement || null });
  } catch (e) {
    return next(e);
  }
};

/**
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.getAll = async (req, res, next) => {
  try {
    const data = await Service.getByData({}, { singleResult: true });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data },
      `${entityName} data`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.updateTerms = async (req, res, next) => {
  try {
    const {
      body: { termsConditions },
    } = req;

    let data = await Service.getByData({}, { singleResult: true });

    if (data) {
      data.termsConditions = termsConditions;
      await data.save();
    } else {
      data = await Service.create({ termsConditions });
    }

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.updatePolicy = async (req, res, next) => {
  try {
    const {
      body: { privacyPolicy },
    } = req;

    let data = await Service.getByData({}, { singleResult: true });

    if (data) {
      data.privacyPolicy = privacyPolicy;
      await data.save();
    } else {
      data = await Service.create({ privacyPolicy });
    }

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.updateAgreement = async (req, res, next) => {
  try {
    const {
      body: { agreement },
    } = req;

    let data = await Service.getByData({}, { singleResult: true });

    if (data) {
      data.agreement = agreement;
      await data.save();
    } else {
      data = await Service.create({ agreement });
    }

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};

/**
 * Update free dessert settings
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.updateFreeDessert = async (req, res, next) => {
  try {
    const {
      body: { freeDessertAmount, freeDessertOrderCount, isFreeDessertEnabled },
    } = req;

    let data = await Service.getByData({}, { singleResult: true });

    if (data) {
      data.freeDessertAmount = freeDessertAmount;
      data.freeDessertOrderCount = freeDessertOrderCount;
      data.isFreeDessertEnabled = isFreeDessertEnabled;
      await data.save();
    } else {
      data = await Service.create({ 
        freeDessertAmount, 
        freeDessertOrderCount, 
        isFreeDessertEnabled 
      });
    }

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data },
      `${entityName} updated`
    );
  } catch (e) {
    return next(e);
  }
};
