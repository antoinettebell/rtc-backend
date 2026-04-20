const { PlanService: Service } = require('../services');
const entityName = 'Plan';

/**
 * To list out or find data by id of given collection
 * Support GET request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.list = async (req, res, next) => {
  try {
    let {
      query: { limit = 10, page = 1, search },
      params: { id: _id },
    } = req;
    const data = await Service.getByData({});
    return res.data(
      {
        [`${entityName.toLocaleLowerCase()}List`]: data,
      },
      `${entityName} items`
    );
  } catch (e) {
    return next(e);
  }
};
