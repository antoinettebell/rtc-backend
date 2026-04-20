const { MeatService: Service } = require('../services');
const entityName = 'Meat';

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

/**
 * To add new entry to given collection
 * Support POST request
 *
 * @param req
 * @param res
 * @param next
 * @returns {Promise<*>}
 */
exports.add = async (req, res, next) => {
  try {
    const {
      body: { name },
    } = req;

    const existRecord = await Service.getByData(
      { name: { $regex: `\\b${name}\\b`, $options: 'i' }, deletedAt: null },
      { singleResult: true }
    );

    if (existRecord) {
      return res.error(
        new Error(`${entityName} with this name is already exists.`),
        409
      );
    }

    const data = await Service.create({ name });

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: data },
      `${entityName} added`
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
exports.update = async (req, res, next) => {
  try {
    const {
      body: { name },
      params: { id },
    } = req;

    const existRecord = await Service.getByData(
      {
        name: { $regex: `\\b${name}\\b`, $options: 'i' },
        _id: { $ne: id },
        deletedAt: null,
      },
      { singleResult: true }
    );

    if (existRecord) {
      return res.error(
        new Error(`${entityName} with this name is already exists.`),
        409
      );
    }

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error(`No ${entityName} found`), 409);
    }

    if (name) {
      item.name = name;
    }

    await item.save();

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
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
exports.destroy = async (req, res, next) => {
  try {
    const {
      params: { id },
    } = req;

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error(`No ${entityName} found`), 409);
    }

    item.deletedAt = new Date().toISOString();

    await item.save();

    return res.data(
      { [`${entityName.toLocaleLowerCase()}`]: item },
      `${entityName} deleted`
    );
  } catch (e) {
    return next(e);
  }
};
