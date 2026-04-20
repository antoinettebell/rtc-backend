const { AddOnsService: Service } = require('../services');
const entityName = 'AddOns';

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
    if (_id) {
      let item = await Service.getById(_id);
      return res.data(
        { [`${entityName.toLocaleLowerCase()}`]: item },
        `${entityName} item`
      );
    }

    let q = {};
    if (search && search.trim()) {
      q = {
        $or: [{ name: { $regex: search.trim().toLowerCase(), $options: 'i' } }],
      };
    }
    const data = await Service.getByData(
      { ...q, deletedAt: null },
      { paging: { limit, page }, lean: true }
    );

    const total = await Service.getCount({
      ...q,
      deletedAt: null,
    });
    return res.data(
      {
        [`${entityName.toLocaleLowerCase()}List`]: data,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      `${entityName} items`
    );
  } catch (e) {
    return next(e);
  }
};
