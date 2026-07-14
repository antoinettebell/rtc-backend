const { AddOnsService: Service } = require('../services');
const entityName = 'AddOns';

const isSocialMediaAddOn = (name = '') =>
  /social\s*media|social\s*promotion|social\s*management/i.test(name);

const isAdSpaceAddOn = (name = '') =>
  /ad\s*space|advertis|banner|social\s*media|social\s*promotion|social\s*management/i.test(
    name
  );

const isPrinterAddOn = (name = '') =>
  /printer|printing|print\s*setup|order\s*print/i.test(name);

const isPublicAddOn = (name = '') => isAdSpaceAddOn(name) || isPrinterAddOn(name);

const normalizeAddOn = (addOn) => {
  if (!addOn) {
    return addOn;
  }

  const source = typeof addOn.toObject === 'function' ? addOn.toObject() : addOn;
  const name = source.name || '';

  if (isSocialMediaAddOn(name) || /ad\s*space|advertis|banner/i.test(name)) {
    return {
      ...source,
      name: 'Ad Space',
      priceLabel: source.priceLabel || '$125/month',
      description: 'Monthly advertising placement for RTC ad inventory.',
    };
  }

  if (isPrinterAddOn(name)) {
    return {
      ...source,
      name: 'Printer',
      priceLabel: source.priceLabel || '$50 one-time fee',
      description: 'Printer setup add-on for vendor order ticket printing.',
    };
  }

  return source;
};

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
      let item = normalizeAddOn(await Service.getById(_id));
      return res.data(
        { [`${entityName.toLocaleLowerCase()}`]: item },
        `${entityName} item`
      );
    }

    let q = {};
    if (search && search.trim()) {
      const searchText = search.trim();
      const searchRegex =
        /ad\s*space/i.test(searchText)
          ? 'ad space|advertis|banner|social media|social promotion|social management'
          : searchText.toLowerCase();
      q = {
        $or: [{ name: { $regex: searchRegex, $options: 'i' } }],
      };
    }
    const records = await Service.getByData(
      { ...q, deletedAt: null },
      { paging: { limit, page }, lean: true }
    );
    const data = records
      .filter((item) => isPublicAddOn(item?.name || ''))
      .map(normalizeAddOn);

    const total = data.length;
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
