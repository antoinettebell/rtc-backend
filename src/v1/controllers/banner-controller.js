const { BannerService: Service } = require('../services');
const entityName = 'Banner';

const isPublicRequest = (req) => req.originalUrl.includes('/public/banner');

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
      item = await Service.attachAdMetrics(item);
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
    const publicFilters = {};
    if (isPublicRequest(req)) {
      const now = new Date();
      publicFilters.isActive = true;
      publicFilters.$and = [
        {
          $or: [{ fromDate: null }, { fromDate: { $lte: now } }],
        },
        {
          $or: [{ toDate: null }, { toDate: { $gte: now } }],
        },
      ];
    }

    const data = await Service.getByData(
      { ...q, ...publicFilters, deletedAt: null },
      { paging: { limit, page }, lean: true }
    );
    const dataWithMetrics = isPublicRequest(req)
      ? data
      : await Service.attachAdMetrics(data);

    const total = await Service.getCount({
      ...q,
      ...publicFilters,
      deletedAt: null,
    });
    return res.data(
      {
        [`${entityName.toLocaleLowerCase()}List`]: dataWithMetrics,
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
      body: {
        title,
        description,
        imageUrl,
        adVendorName,
        adDestinationUrl,
        isActive = true,
        fromDate,
        toDate,
      },
    } = req;

    const data = await Service.create({
      title,
      description,
      imageUrl,
      adVendorName,
      adDestinationUrl: Service.sanitizeDestinationUrl(adDestinationUrl),
      isActive,
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
      body: {
        title,
        description,
        imageUrl,
        adVendorName,
        adDestinationUrl,
        isActive,
        fromDate,
        toDate,
      },
      params: { id },
    } = req;

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No banner found'), 409);
    }

    if (title !== undefined) {
      item.title = title;
    }

    if (description !== undefined) {
      item.description = description;
    }

    if (imageUrl !== undefined) {
      item.imageUrl = imageUrl;
    }

    if (adVendorName !== undefined) {
      item.adVendorName = adVendorName;
    }

    if (adDestinationUrl !== undefined) {
      item.adDestinationUrl = Service.sanitizeDestinationUrl(adDestinationUrl);
    }

    if (isActive !== undefined) {
      item.isActive = isActive;
    }

    if (fromDate !== undefined) {
      item.fromDate = fromDate;
    }

    if (toDate !== undefined) {
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

exports.trackEvent = async (req, res, next) => {
  try {
    const {
      params: { id, eventType },
    } = req;

    const eventMap = {
      impression: 'IMPRESSION',
      click: 'CLICK',
    };

    if (!eventMap[eventType]) {
      return res.error(new Error('Invalid ad event'), 409);
    }

    await Service.recordAdEvent({
      bannerId: id,
      eventType: eventMap[eventType],
    });

    return res.data({ tracked: true }, 'Ad event tracked');
  } catch (e) {
    return next(e);
  }
};
