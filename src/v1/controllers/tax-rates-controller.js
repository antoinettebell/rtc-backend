const { TaxRatesService: Service, FoodTruckService } = require('../services');
const entityName = 'TaxRates';
const taxHelper = require('../../helper/tax-helper');
const DEFAULT_TAX_RATE = 0.06;

const toMoney = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

const calculateTaxAmountFromRate = (amount, rate) => {
  const taxableAmount = toMoney(amount);
  const numericRate = Number(rate) || 0;
  const normalizedRate = numericRate > 1 ? numericRate / 100 : numericRate;

  return Number((taxableAmount * normalizedRate).toFixed(2));
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
          { stateCode: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          { zip: { $regex: search.trim().toLowerCase(), $options: 'i' } },
          { taxRegion: { $regex: search.trim().toLowerCase(), $options: 'i' } },
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

exports.check = async (req, res, next) => {
  try {
    let {
      query: { foodTruckId, locationId },
    } = req;

    const data = {};

    const ft = await FoodTruckService.getById(foodTruckId);
    if (ft) {
      const loc = ft.locations.find(
        (itm) => itm.zipcode && itm._id.toString() === locationId
      );
      if (loc) {
        const tax = await Service.getByData(
          { zip: loc.zipcode },
          { singleResult: true }
        );
        data._id = tax?._id;
        data.salesTax = tax?.estimatedCombineRate || 0;
      }
    }

    data.paymentProcessingFee = 3.5;

    return res.data(data, `${entityName}`);
  } catch (e) {
    return next(e);
  }
};
exports.avalarataxcheck = async (req, res, next) => {
  try {
    let {
      query: { foodTruckId, locationId, amount },
    } = req;

    const data = {};

    const ft = await FoodTruckService.getById(foodTruckId);
    if (ft) {
      const loc = ft.locations.find(
        (itm) => itm.zipcode && itm._id.toString() ===  locationId
          // (itm) => itm.zipcode && itm._id.toString() === '68e92372cd977c83ce036729'
      );
      if (loc) {
        const tax = await Service.getByData(
          { zip: loc.zipcode },
          { singleResult: true }
        );
        data._id = tax?._id;
        data.salesTax = DEFAULT_TAX_RATE;
        data.salesTaxAmount = calculateTaxAmountFromRate(
          amount,
          DEFAULT_TAX_RATE
        );
        const parsed = await taxHelper.parseDynamicAddress(loc);
        console.log("parsing address",parsed);
        const from = {
          line1: parsed.lines || null,
          city: parsed.city,
          region: parsed.region ,
          postalCode:parsed.postalCode ,
          country: parsed.country,
          latitude: parsed.latitude || null,
          longitude: parsed.longitude || null,
        };
        const result = await taxHelper.calculateAvalaraTax({
          shipFrom:from,
          shipTo:from,
          amount: amount || 100,
        });
        if (result?.success) {
            data.salesTax = result?.totalTax || 0;
            data.salesTaxAmount = result?.totalTax || 0;
          } else {
            data.avalaraError = result?.message || null;
          }
      }
    }

    data.paymentProcessingFee = 3.5;

    return res.data(data, `${entityName}`);
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
        stateCode,
        zip,
        taxRegion,
        estimatedCombineRate,
        stateRate,
        estimatedCountryRate,
        estimatedCityRate,
        estimatedSpecialRate,
        riskLevel,
      },
    } = req;

    const data = await Service.updateDetail(`${stateCode}-${zip}`, {
      stateCode,
      zip,
      taxRegion,
      estimatedCombineRate,
      stateRate,
      estimatedCountryRate,
      estimatedCityRate,
      estimatedSpecialRate,
      riskLevel,
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
exports.destroy = async (req, res, next) => {
  try {
    const {
      params: { id },
    } = req;

    const item = await Service.getById(id);
    if (!item) {
      return res.error(new Error('No Cuisine found'), 409);
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
