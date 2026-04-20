const { BannerService: Service } = require('../services');
const entityName = 'Banner';

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
        $or: [
          { title: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          {
            description: { $regex: search.trim().toLowerCase(), $options: 'i' },
          },
        ],
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
      body: { title, description, imageUrl, fromDate, toDate },
    } = req;

    const data = await Service.create({
      title,
      description,
      imageUrl,
      fromDate,
      toDate,
    });

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
      body: { title, description, imageUrl, fromDate, toDate },
      params: { id },
    } = req;

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No banner found'), 409);
    }

    if (title) {
      item.title = title;
    }

    if (description) {
      item.description = description;
    }

    if (imageUrl) {
      item.imageUrl = imageUrl;
    }

    if (fromDate) {
      item.fromDate = fromDate;
    }

    if (toDate) {
      item.toDate = toDate;
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
      return res.error(new Error('No Banner found'), 409);
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
