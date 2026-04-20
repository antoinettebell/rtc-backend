exports.getById = async (model, id, options, field = null) => {
  if (!options) options = {};
  options.singleResult = true;
  return await this.list(model, { _id: id }, options, field);
};

exports.getOne = async (model, params, options, fields) => {
  if (!options) options = {};
  options.singleResult = true;
  return await this.list(model, params, options, fields);
};

exports.getCount = async (model, params, options) => {
  if (!options) options = {};
  return await this.list(model, params, { count: true, ...options });
};

exports.getDistinct = async (model, params, options) => {
  if (!options) options = {};
  return await this.list(model, params, { distinct: true, ...options });
};

exports.list = async (model, params, options, fields = null) => {
  if (!options) options = {};
  const {
    count,
    singleResult,
    sort,
    paging,
    lean,
    populate,
    limit,
    distinct,
    distinctField,
  } = options;
  let result = null;
  if (singleResult) {
    result = model.findOne(params);
  } else if (count) {
    result = model.countDocuments(params);
  } else if (distinct) {
    result = model.distinct(distinctField, params);
  } else {
    result = model.find(params);
  }
  if (fields) {
    result = result.select(fields);
  }
  if (limit) {
    result = result.limit(limit);
  }
  if (paging) {
    paging.page = paging.page || 1;
    result = result.limit(paging.limit).skip((paging.page - 1) * paging.limit);
  }
  if (sort) {
    result = result.sort(sort);
  }
  if (lean) {
    result = result.lean();
  }
  if (populate) {
    result = result.populate(populate);
  }
  return await result;
};

exports.save = async (model, filter, updatedFields, options) => {
  if (!options) options = {};
  let result;
  let {
    lean,
    getNew,
    set = true,
    pull = false,
    push = false,
    pop = false,
    upsert,
    updateSetKey,
    directApply,
    populate,
  } = options;
  let updateKey = '$set';
  if (!set && pull) {
    updateKey = '$pull';
  }
  if (!set && push) {
    updateKey = '$push';
  }
  if (!set && pop) {
    updateKey = '$pop';
  }
  if (updateSetKey) {
    updateKey = updateSetKey;
  }

  let data = {};
  if (directApply) {
    data = updatedFields;
  } else {
    data = { [updateKey]: updatedFields };
  }

  if (filter) {
    result = await model.findOneAndUpdate(filter, data, {
      new: getNew,
      lean: lean,
      upsert: upsert,
      populate,
    });
  } else {
    result = await model.create(updatedFields);
  }
  return result;
};

exports.destroy = async (model, params) => {
  return await model.findOneAndDelete(params);
};

exports.destroyMany = async (model, params) => {
  return await model.deleteMany(params);
};

exports.delete = async (model, params) => {
  return await model.deleteMany(params);
};

exports.getAggregates = async (model, options) => {
  if (!options) options = {};
  let {
    applyMatchOnStart = true,
    filter,
    project,
    lookup,
    sort,
    facet,
    unwindCount = true,
  } = options;
  let finalAggregates = [];
  if (applyMatchOnStart && filter) {
    finalAggregates.push({ $match: filter });
  }

  if (lookup) {
    lookup.forEach((item) => {
      finalAggregates.push({
        $lookup: {
          from: item.table,
          localField: item.localField,
          foreignField: item.foreignField,
          as: item.alias,
          ...(item.pipeline ? { pipeline: item.pipeline } : {}),
        },
      });
      finalAggregates.push({ $unwind: `$${item.alias}` });
    });
  }
  if (!applyMatchOnStart && filter) {
    finalAggregates.push({ $match: filter });
  }
  if (project) {
    finalAggregates.push({ $project: project });
  }
  if (sort) {
    finalAggregates.push({ $sort: sort });
  }
  if (facet) {
    finalAggregates.push({ $facet: facet });
    if (unwindCount) {
      finalAggregates.push({ $unwind: '$count' });
    }
  }
  let finalData = await model.aggregate(finalAggregates);
  return finalData && finalData[0]
    ? finalData[0]
    : { data: [], count: { total: 0, page: 0 } };
};
