const { FoodTruckModel: Model,UserRestrictDietModel } = require('../../models');
const { BaseService } = require('../../common-services');
const mongoose = require('mongoose');

class FoodTruckService extends BaseService {
  constructor() {
    super(Model);
  }

  // async getNormalList(limit, page, q, extraQ, user, lat, long, distanceMeters) {
  //   const userLat = parseFloat(lat);
  //   const userLong = parseFloat(long);

  //   q['menu.0'] = { $exists: true };
  //   q['menu.available'] = true;

  //   const data = (
  //     await Model.aggregate([
  //       ...(userLat && userLong
  //         ? this._getDistanceConfig(userLat, userLong)
  //         : []),
  //       {
  //         $lookup: {
  //           from: 'cuisines',
  //           localField: 'cuisine',
  //           foreignField: '_id',
  //           as: 'cuisine',
  //         },
  //       },
  //       {
  //         $lookup: {
  //           from: 'reviews',
  //           localField: '_id',
  //           foreignField: 'foodTruckId',
  //           as: 'reviews',
  //         },
  //       },
  //       {
  //         $addFields: {
  //           avgRate: {
  //             $cond: [
  //               { $gt: [{ $size: '$reviews' }, 0] },
  //               { $round: [{ $avg: '$reviews.rate' }, 1] },
  //               0,
  //             ],
  //           },
  //           totalReviews: { $size: '$reviews' },
  //         },
  //       },
  //       {
  //         $lookup: {
  //           from: 'menu-items',
  //           localField: 'userId',
  //           foreignField: 'userId',
  //           as: 'menu',
  //         },
  //       },
  //       { $match: { ...q, ...extraQ, 'cuisine.deletedAt': null } },
  //       ...(userLat && userLong && distanceMeters
  //         ? [{ $match: { distance: { $lte: parseFloat(distanceMeters) } } }]
  //         : []),
  //       { $sort: { distance: 1, createdAt: -1 } },
  //       {
  //         $project: {
  //           reviews: 0,
  //           menu: 0,
  //           minLocationData: 0,
  //           locationsComputed: 0,
  //           matchedLocation: 0,
  //           locationIdExists: 0,
  //           // distanceInMeters: '$distance',
  //         },
  //       },
  //       {
  //         $facet: {
  //           data: [{ $skip: (page - 1) * +limit }, { $limit: +limit }],
  //           total: [{ $count: 'count' }],
  //         },
  //       },
  //       {
  //         $project: {
  //           data: 1,
  //           total: { $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0] },
  //         },
  //       },
  //     ])
  //   )[0];
  //   console.log("Ddd",data)
  //   return {
  //     data: (data.data || []).map((itm) => {
  //       const { distance, ...rest } = itm;
  //       return { ...rest, distanceInMeters: distance };
  //     }),
  //     total: data.total,
  //   };
  // }

  async getNormalList(limit, page, q, extraQ, user, lat, long, distanceMeters) {
    try {
      const userLat = parseFloat(lat);
      const userLong = parseFloat(long);
  
      q['menu.0'] = { $exists: true };
      q['menu.available'] = true;
  
      // Get restricted diet ids for customer
      let restrictedDietIds = [];
      if (user?.userType === "CUSTOMER") {
        const restrictDoc = await UserRestrictDietModel.findOne({
          userId: user._id,
          deletedAt: null,
        }).lean();
  
        restrictedDietIds = restrictDoc?.diet || [];
      }
  
      const data = (
        await Model.aggregate([
          ...(userLat && userLong ? this._getDistanceConfig(userLat, userLong) : []),
            {
            $lookup: {
              from: 'cuisines',
              localField: 'cuisine',
              foreignField: '_id',
              as: 'cuisine',
            },
          },
            {
            $lookup: {
              from: 'reviews',
              localField: '_id',
              foreignField: 'foodTruckId',
              as: 'reviews',
            },
          },
            {
            $addFields: {
              avgRate: {
                $cond: [
                  { $gt: [{ $size: '$reviews' }, 0] },
                  { $round: [{ $avg: '$reviews.rate' }, 1] },
                  0,
                ],
              },
              totalReviews: { $size: '$reviews' },
            },
          },
          {
            $lookup: {
              from: 'menu-items',
              let: { uid: '$userId' },
              pipeline: [
                { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
                { $match: { deletedAt: null, available: true } },
                ...(restrictedDietIds.length > 0
                  ? [
                      {
                        $match: {
                          diet: { $not: { $elemMatch: { $in: restrictedDietIds } } },
                        },
                      },
                    ]
                  : []),
              ],
              as: 'menu',
            },
          },
          { $match: { ...q, ...extraQ, 'cuisine.deletedAt': null } },
            ...(userLat && userLong && distanceMeters
            ? [{ $match: { distance: { $lte: parseFloat(distanceMeters) } } }]
            : []),
            { $sort: { distance: 1, createdAt: -1 } },
            {
            $project: {
              reviews: 0,
              minLocationData: 0,
              locationsComputed: 0,
              matchedLocation: 0,
              locationIdExists: 0,
            },
          },
            {
            $facet: {
              data: [{ $skip: (page - 1) * +limit }, { $limit: +limit }],
              total: [{ $count: 'count' }],
            },
          },
          {
            $project: {
              data: 1,
              total: { $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0] },
            },
          },
        ])
      )[0];
  
      return {
        data: (data?.data || []).map((itm) => {
          const { distance, ...rest } = itm;
          return { ...rest, distanceInMeters: distance };
        }),
        total: data?.total || 0,
      };
    } catch (err) {
      console.error("Error in getNormalList:", err);
      throw err; // Let error-handler send proper status code
    }
  }
  
  async getRatting(fts) {
    const data = {};
    (
      await Model.aggregate([
        {
          $match: {
            _id: {
              $in: (fts || []).map(
                (itm) => new mongoose.Types.ObjectId(itm._id.toString())
              ),
            },
          },
        },
        {
          $lookup: {
            from: 'reviews',
            localField: '_id',
            foreignField: 'foodTruckId',
            as: 'reviews',
          },
        },
        {
          $addFields: {
            avgRate: {
              $cond: [
                { $gt: [{ $size: '$reviews' }, 0] },
                { $round: [{ $avg: '$reviews.rate' }, 1] },
                0,
              ],
            },
            totalReviews: { $size: '$reviews' },
          },
        },
      ])
    ).map((itm) => {
      data[itm._id.toString()] = {
        avgRate: itm.avgRate,
        totalReviews: itm.totalReviews,
      };
    });

    return data;
  }

  async getWithFilters(
    day,
    currentTime,
    lat,
    long,
    limit,
    page,
    search,
    distanceMeters
  ) {
    const userLat = parseFloat(lat);
    const userLong = parseFloat(long);

    let q = {};
    let extraConf = [];
    let extraSort = {};

    if (search?.trim()) {
      const words = search
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w);
      const regex = new RegExp(search, 'i');
      const wordRegexes = words.map((w) => new RegExp(w, 'i'));

      const fullPhraseConditions = [
        { name: regex },
        { 'cuisine.name': regex },
        { 'locations.title': regex },
        { 'locations.address': regex },
      ];

      const wordConditions = wordRegexes.flatMap((r) => [
        { name: r },
        { 'cuisine.name': r },
        { 'locations.title': r },
        { 'locations.address': r },
      ]);

      q = {
        $or: [...fullPhraseConditions, ...wordConditions],
      };

      extraConf = [
        {
          $addFields: {
            searchScore: {
              $cond: [
                {
                  $or: fullPhraseConditions.map((condition) => ({
                    $regexMatch: {
                      input: { $toString: Object.keys(condition)[0] },
                      regex: regex,
                    },
                  })),
                },
                2,
                1,
              ],
            },
          },
        },
      ];

      extraSort = { searchScore: -1 };
    }

    q['menu.0'] = { $exists: true };
    q['menu.available'] = true;

    return (
      await Model.aggregate([
        { $unwind: '$availability' },
        {
          $lookup: {
            from: 'cuisines',
            localField: 'cuisine',
            foreignField: '_id',
            as: 'cuisine',
          },
        },
        {
          $lookup: {
            from: 'reviews',
            localField: '_id',
            foreignField: 'foodTruckId',
            as: 'reviews',
          },
        },
        {
          $addFields: {
            avgRate: {
              $cond: [
                { $gt: [{ $size: '$reviews' }, 0] },
                { $round: [{ $avg: '$reviews.rate' }, 1] },
                0,
              ],
            },
            totalReviews: { $size: '$reviews' },
          },
        },

        {
          $lookup: {
            from: 'menu-items',
            localField: 'userId',
            foreignField: 'userId',
            as: 'menu',
          },
        },

        {
          $match: {
            inactive: false,
            verified: true,
            'cuisine.deletedAt': null,
            'availability.day': day,
            'availability.available': true,
            $expr: {
              $let: {
                vars: {
                  start: {
                    $dateFromString: {
                      dateString: {
                        $concat: [
                          '1970-01-01T',
                          '$availability.startTime',
                          ':00Z',
                        ],
                      },
                    },
                  },
                  end: {
                    $dateFromString: {
                      dateString: {
                        $concat: [
                          '1970-01-01T',
                          '$availability.endTime',
                          ':00Z',
                        ],
                      },
                    },
                  },
                  current: {
                    $dateFromString: {
                      dateString: {
                        $concat: ['1970-01-01T', currentTime, ':00Z'],
                      },
                    },
                  },
                },
                in: {
                  $cond: [
                    { $lt: ['$$end', '$$start'] }, // overnight availability
                    {
                      $or: [
                        { $gte: ['$$current', '$$start'] },
                        { $lt: ['$$current', '$$end'] },
                      ],
                    },
                    {
                      $and: [
                        { $gte: ['$$current', '$$start'] },
                        { $lt: ['$$current', '$$end'] },
                      ],
                    },
                  ],
                },
              },
            },
            ...q,
          },
        },
        ...extraConf,
        {
          $addFields: {
            matchedLocation: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: '$locations',
                    cond: {
                      $eq: [
                        '$$this._id',
                        { $toObjectId: '$availability.locationId' },
                      ],
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        { $match: { matchedLocation: { $ne: null } } },
        {
          $addFields: {
            locLat: { $toDouble: '$matchedLocation.lat' },
            locLong: { $toDouble: '$matchedLocation.long' },
          },
        },

        // calculate distance
        {
          $addFields: {
            distance: {
              $let: {
                vars: {
                  lat1: userLat,
                  lon1: userLong,
                  lat2: '$locLat',
                  lon2: '$locLong',
                  degToRad: 0.017453292519943295, // Math.PI / 180
                },
                in: {
                  $let: {
                    vars: {
                      dLat: {
                        $multiply: [
                          { $subtract: ['$$lat2', '$$lat1'] },
                          '$$degToRad',
                        ],
                      },
                      dLon: {
                        $multiply: [
                          { $subtract: ['$$lon2', '$$lon1'] },
                          '$$degToRad',
                        ],
                      },
                      a: {
                        $add: [
                          {
                            $pow: [
                              {
                                $sin: {
                                  $divide: [
                                    {
                                      $multiply: [
                                        { $subtract: ['$$lat2', '$$lat1'] },
                                        '$$degToRad',
                                      ],
                                    },
                                    2,
                                  ],
                                },
                              },
                              2,
                            ],
                          },
                          {
                            $multiply: [
                              { $cos: { $multiply: ['$$lat1', '$$degToRad'] } },
                              { $cos: { $multiply: ['$$lat2', '$$degToRad'] } },
                              {
                                $pow: [
                                  {
                                    $sin: {
                                      $divide: [
                                        {
                                          $multiply: [
                                            { $subtract: ['$$lon2', '$$lon1'] },
                                            '$$degToRad',
                                          ],
                                        },
                                        2,
                                      ],
                                    },
                                  },
                                  2,
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    },
                    in: {
                      $multiply: [
                        6371000, // Earth radius in meters
                        2,
                        {
                          $atan2: [
                            { $sqrt: '$$a' },
                            { $sqrt: { $subtract: [1, '$$a'] } },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        ...(distanceMeters
          ? [{ $match: { distance: { $lte: parseFloat(distanceMeters) } } }]
          : []),
        { $sort: { ...extraSort, distance: 1 } },
        {
          $project: {
            name: 1,
            userId: 1,
            avgRate: 1,
            totalReviews: 1,
            availability: 1,
            cuisine: 1,
            logo: 1,
            photos: 1,
            location: '$matchedLocation',
            distanceInMeters: '$distance',
          },
        },

        {
          $facet: {
            data: [{ $skip: (page - 1) * +limit }, { $limit: +limit }],
            total: [{ $count: 'count' }],
          },
        },
        {
          $project: {
            data: 1,
            total: { $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0] },
          },
        },
      ])
    )[0];
  }
///old  code
  // async getWithFiltersNew(
  //   day,
  //   currentTime,
  //   lat,
  //   long,
  //   limit,
  //   page,
  //   search,
  //   distanceMeters,
  //   available,
  //   featured
  // ) {
  //   const userLat = parseFloat(lat);
  //   const userLong = parseFloat(long);

  //   let q = {};
  //   const extraLookup = [];
  //   let extraConf = [];
  //   let extraSort = {};

  //   if (search?.trim()) {
  //     const words = search
  //       .trim()
  //       .toLowerCase()
  //       .split(/\s+/)
  //       .filter((w) => w);
  //     const regex = new RegExp(search, 'i');
  //     const wordRegexes = words.map((w) => new RegExp(w, 'i'));

  //     extraLookup.push({
  //       $lookup: {
  //         from: 'diets',
  //         localField: 'menu.diet',
  //         foreignField: '_id',
  //         as: 'diets',
  //       },
  //     });

  //     const fullPhraseConditions = [
  //       { name: regex },
  //       { 'cuisine.name': regex },
  //       { 'menu.name': regex },
  //       { 'diets.name': regex },
  //       // { 'locations.title': regex },
  //       // { 'locations.address': regex },
  //     ];

  //     const wordConditions = wordRegexes.flatMap((r) => [
  //       { name: r },
  //       { 'cuisine.name': r },
  //       { 'menu.name': r },
  //       { 'diets.name': r },
  //       // { 'locations.title': r },
  //       // { 'locations.address': r },
  //     ]);

  //     q = {
  //       $or: [...fullPhraseConditions, ...wordConditions],
  //     };

  //     extraConf = [
  //       {
  //         $addFields: {
  //           searchScore: {
  //             $cond: [
  //               {
  //                 $or: fullPhraseConditions.map((condition) => ({
  //                   $regexMatch: {
  //                     input: { $toString: Object.keys(condition)[0] },
  //                     regex: regex,
  //                   },
  //                 })),
  //               },
  //               2,
  //               1,
  //             ],
  //           },
  //         },
  //       },
  //     ];

  //     extraSort = { searchScore: -1 };
  //   }

  //   if ([true, 'true', 1, '1'].includes(available)) {
  //     q['currentLocation'] = { $exists: 1 };
  //   }

  //   if ([true, 'true', 1, '1'].includes(featured)) {
  //     q['featured'] = true;
  //   }

  //   q['menu.0'] = { $exists: true };
  //   q['menu.available'] = true;

  //   return (
  //     await Model.aggregate([
  //       { $match: { inactive: false, verified: true } },
  //       ...this._getDistanceConfig(userLat, userLong),
  //       {
  //         $lookup: {
  //           from: 'cuisines',
  //           localField: 'cuisine',
  //           foreignField: '_id',
  //           as: 'cuisine',
  //         },
  //       },
  //       {
  //         $lookup: {
  //           from: 'reviews',
  //           localField: '_id',
  //           foreignField: 'foodTruckId',
  //           as: 'reviews',
  //         },
  //       },
  //       {
  //         $addFields: {
  //           avgRate: {
  //             $cond: [
  //               { $gt: [{ $size: '$reviews' }, 0] },
  //               { $round: [{ $avg: '$reviews.rate' }, 1] },
  //               0,
  //             ],
  //           },
  //           totalReviews: { $size: '$reviews' },
  //         },
  //       },
  //       {
  //         $lookup: {
  //           from: 'menu-items',
  //           localField: 'userId',
  //           foreignField: 'userId',
  //           as: 'menu',
  //         },
  //       },
  //       ...extraLookup,
  //       {
  //         $match: {
  //           'cuisine.deletedAt': null,
  //           // 'availability.day': day,
  //           // 'availability.available': true,
  //           ...q,
  //         },
  //       },
  //       ...extraConf,
  //       ...(distanceMeters
  //         ? [{ $match: { distance: { $lte: parseFloat(distanceMeters) } } }]
  //         : []),
  //       { $sort: { ...extraSort, distance: 1 } },
  //       {
  //         $project: {
  //           name: 1,
  //           userId: 1,
  //           avgRate: 1,
  //           totalReviews: 1,
  //           availability: 1,
  //           cuisine: 1,
  //           logo: 1,
  //           photos: 1,
  //           currentLocation: 1,
  //           featured: 1,
  //           'menu._id': 1,
  //           'menu.name': 1,
  //           'menu.diet': 1,
  //           'diets._id': 1,
  //           'diets.name': 1,
  //           location: '$matchedLocation',
  //           distanceInMeters: '$distance',
  //         },
  //       },

  //       {
  //         $facet: {
  //           data: [{ $skip: (page - 1) * +limit }, { $limit: +limit }],
  //           total: [{ $count: 'count' }],
  //         },
  //       },
  //       {
  //         $project: {
  //           data: 1,
  //           total: { $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0] },
  //         },
  //       },
  //     ])
  //   )[0];
  // }

//new code
  async getWithFiltersNew(
    user,
    day,
    currentTime,
    lat,
    long,
    limit,
    page,
    search,
    distanceMeters,
    available,
    featured
  ) {
    try {
      const userLat = parseFloat(lat);
      const userLong = parseFloat(long);
  
      let q = {};
      const extraLookup = [];
      let extraConf = [];
      let extraSort = {};
      let restrictedDietIds = [];
  
      // get restricted diets for CUSTOMER
      if (user?.userType === "CUSTOMER") {
        const restrictDoc = await UserRestrictDietModel.findOne({
          userId: user._id,
          deletedAt: null,
        }).lean();
  
        restrictedDietIds = restrictDoc?.diet || [];
      }
  
      if (search?.trim()) {
        const words = search
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w);
        const regex = new RegExp(search, 'i');
        const wordRegexes = words.map((w) => new RegExp(w, 'i'));
  
        extraLookup.push({
          $lookup: {
            from: 'diets',
            localField: 'menu.diet',
            foreignField: '_id',
            as: 'diets',
          },
        });
  
        const fullPhraseConditions = [
          { name: regex },
          { 'cuisine.name': regex },
          { 'menu.name': regex },
          { 'diets.name': regex },
          { 'user.firstName': regex },
          { 'user.lastName': regex },

          // { 'locations.title': regex },
          // { 'locations.address': regex },
        ];
  
        const wordConditions = wordRegexes.flatMap((r) => [
          { name: r },
          { 'cuisine.name': r },
          { 'menu.name': r },
          { 'diets.name': r },
          { 'user.firstName': r },
          { 'user.lastName': r },


        ]);
  
        q = { 
          $or: [...fullPhraseConditions, ...wordConditions]
         };
  
        extraConf = [
          {
            $addFields: {
              searchScore: {
                $cond: [
                  {
                    $or: fullPhraseConditions.map((condition) => ({
                      $regexMatch: {
                        input: { $toString: Object.keys(condition)[0] },
                        regex: regex,
                      },
                    })),
                  },
                  2,
                  1,
                ],
              },
            },
          },
        ];
  
        extraSort = { searchScore: -1 };
      }
  
      if ([true, 'true', 1, '1'].includes(available)) {
        q['currentLocation'] = { $exists: 1 };
      }
  
      if ([true, 'true', 1, '1'].includes(featured)) {
        q['featured'] = true;
      }
  
      q['menu.0'] = { $exists: true };
      q['menu.available'] = true;
  
      const data = (
        await Model.aggregate([
          { $match: { inactive: false, verified: true } },
          ...this._getDistanceConfig(userLat, userLong),
            {
            $lookup: {
              from: 'cuisines',
              localField: 'cuisine',
              foreignField: '_id',
              as: 'cuisine',
            },
          },
  
          {
            $lookup: {
              from: 'reviews',
              localField: '_id',
              foreignField: 'foodTruckId',
              as: 'reviews',
            },
          },
          {
            $addFields: {
              avgRate: {
                $cond: [
                  { $gt: [{ $size: '$reviews' }, 0] },
                  { $round: [{ $avg: '$reviews.rate' }, 1] },
                  0,
                ],
              },
              totalReviews: { $size: '$reviews' },
            },
          },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: '_id',
              as: 'user',
            }
          },
          //menu-items lookup with restricted diets
          {
            $lookup: {
              from: 'menu-items',
              let: { uid: '$userId' },
              pipeline: [
                { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
                { $match: { deletedAt: null, available: true } },
                ...(restrictedDietIds.length > 0
                  ? [
                      {
                        $match: {
                          diet: { $not: { $elemMatch: { $in: restrictedDietIds } } },
                        },
                      },
                    ]
                  : []),
              ],
              as: 'menu',
            },
          },
  
          ...extraLookup,
  
          {
            $match: {
              'cuisine.deletedAt': null,
              // 'availability.day': day,
             // 'availability.available': true,
              ...q,
            },
          },
          ...extraConf,
  
          ...(distanceMeters
            ? [{ $match: { distance: { $lte: parseFloat(distanceMeters) } } }]
            : []),
  
          { $sort: { ...extraSort, distance: 1 } },
  
          {
            $project: {
              name: 1,
              userId: 1,
              avgRate: 1,
              totalReviews: 1,
              availability: 1,
              cuisine: 1,
              logo: 1,
              photos: 1,
              currentLocation: 1,
              featured: 1,
              'menu._id': 1,
              'menu.name': 1,
              'user.firstName': 1,
              'user.lastName': 1,
              'menu.diet': 1,
              'diets._id': 1,
              'diets.name': 1,
              location: '$matchedLocation',
              distanceInMeters: '$distance',
            },
          },
  
          {
            $facet: {
              data: [{ $skip: (page - 1) * +limit }, { $limit: +limit }],
              total: [{ $count: 'count' }],
            },
          },
          {
            $project: {
              data: 1,
              total: { $ifNull: [{ $arrayElemAt: ['$total.count', 0] }, 0] },
            },
          },
        ])
      )[0];  
      return data;
    } catch (err) {
      console.error("Error in getWithFiltersNew:", err);
      throw err;
    }
  }
  

  _getDistanceConfig(userLat, userLong) {
    return [
      {
        $addFields: {
          locationIdExists: {
            $and: [
              { $ne: ['$currentLocation', null] },
              { $ne: ['$currentLocation', ''] },
              { $gt: [{ $type: '$currentLocation' }, 'missing'] },
            ],
          },
        },
      },
      {
        $addFields: {
          matchedLocation: {
            $cond: [
              '$locationIdExists',
              {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: '$locations',
                      as: 'loc',
                      cond: {
                        $eq: ['$$loc._id', { $toObjectId: '$currentLocation' }],
                      },
                    },
                  },
                  0,
                ],
              },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          locLat: {
            $cond: [
              '$locationIdExists',
              { $toDouble: '$matchedLocation.lat' },
              null,
            ],
          },
          locLong: {
            $cond: [
              '$locationIdExists',
              { $toDouble: '$matchedLocation.long' },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          distance: {
            $cond: [
              '$locationIdExists',
              {
                $let: {
                  vars: {
                    lat1: userLat,
                    lon1: userLong,
                    lat2: '$locLat',
                    lon2: '$locLong',
                    degToRad: 0.017453292519943295,
                  },
                  in: {
                    $let: {
                      vars: {
                        // dLat: {
                        //   $multiply: [
                        //     { $subtract: ['$$lat2', '$$lat1'] },
                        //     '$$degToRad',
                        //   ],
                        // },
                        // dLon: {
                        //   $multiply: [
                        //     { $subtract: ['$$lon2', '$$lon1'] },
                        //     '$$degToRad',
                        //   ],
                        // },
                        a: {
                          $add: [
                            {
                              $pow: [
                                // { $sin: { $divide: ['$$dLat', 2] } },
                                {
                                  $sin: {
                                    $divide: [
                                      {
                                        $multiply: [
                                          { $subtract: ['$$lat2', '$$lat1'] },
                                          '$$degToRad',
                                        ],
                                      },
                                      2,
                                    ],
                                  },
                                },
                                2,
                              ],
                            },
                            {
                              $multiply: [
                                {
                                  $cos: {
                                    $multiply: ['$$lat1', '$$degToRad'],
                                  },
                                },
                                {
                                  $cos: {
                                    $multiply: ['$$lat2', '$$degToRad'],
                                  },
                                },
                                {
                                  $pow: [
                                    // { $sin: { $divide: ['$$dLon', 2] } },
                                    {
                                      $sin: {
                                        $divide: [
                                          {
                                            $multiply: [
                                              {
                                                $subtract: ['$$lon2', '$$lon1'],
                                              },
                                              '$$degToRad',
                                            ],
                                          },
                                          2,
                                        ],
                                      },
                                    },
                                    2,
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      },
                      in: {
                        $multiply: [
                          6371000,
                          2,
                          {
                            $atan2: [
                              { $sqrt: '$$a' },
                              { $sqrt: { $subtract: [1, '$$a'] } },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          locationsComputed: {
            $cond: [
              '$locationIdExists',
              [], // if locationId exists, we don't care
              {
                $map: {
                  input: '$locations',
                  as: 'loc',
                  in: {
                    lat: { $toDouble: '$$loc.lat' },
                    long: { $toDouble: '$$loc.long' },
                    location: '$$loc',
                    distance: {
                      $let: {
                        vars: {
                          lat1: userLat,
                          lon1: userLong,
                          lat2: { $toDouble: '$$loc.lat' },
                          lon2: { $toDouble: '$$loc.long' },
                          degToRad: 0.017453292519943295,
                        },
                        in: {
                          $let: {
                            vars: {
                              dLat: {
                                $multiply: [
                                  { $subtract: ['$$lat2', '$$lat1'] },
                                  '$$degToRad',
                                ],
                              },
                              // dLon: {
                              //   $multiply: [
                              //     { $subtract: ['$$lon2', '$$lon1'] },
                              //     '$$degToRad',
                              //   ],
                              // },
                              a: {
                                $add: [
                                  {
                                    $pow: [
                                      // { $sin: { $divide: ['$$dLat', 2] } },
                                      {
                                        $sin: {
                                          $divide: [
                                            {
                                              $multiply: [
                                                {
                                                  $subtract: [
                                                    '$$lat2',
                                                    '$$lat1',
                                                  ],
                                                },
                                                '$$degToRad',
                                              ],
                                            },
                                            2,
                                          ],
                                        },
                                      },
                                      2,
                                    ],
                                  },
                                  {
                                    $multiply: [
                                      {
                                        $cos: {
                                          $multiply: ['$$lat1', '$$degToRad'],
                                        },
                                      },
                                      {
                                        $cos: {
                                          $multiply: ['$$lat2', '$$degToRad'],
                                        },
                                      },
                                      {
                                        $pow: [
                                          {
                                            $sin: {
                                              $divide: [
                                                {
                                                  $multiply: [
                                                    {
                                                      $subtract: [
                                                        '$$lon2',
                                                        '$$lon1',
                                                      ],
                                                    },
                                                    '$$degToRad',
                                                  ],
                                                },
                                                2,
                                              ],
                                            },
                                          },
                                          2,
                                        ],
                                      },
                                    ],
                                  },
                                ],
                              },
                            },
                            in: {
                              $multiply: [
                                6371000,
                                2,
                                {
                                  $atan2: [
                                    { $sqrt: '$$a' },
                                    { $sqrt: { $subtract: [1, '$$a'] } },
                                  ],
                                },
                              ],
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
      {
        $addFields: {
          minLocationData: {
            $cond: [
              '$locationIdExists',
              null,
              {
                $reduce: {
                  input: '$locationsComputed',
                  initialValue: { distance: Number.MAX_VALUE },
                  in: {
                    $cond: [
                      { $lt: ['$$this.distance', '$$value.distance'] },
                      '$$this',
                      '$$value',
                    ],
                  },
                },
              },
            ],
          },
        },
      },
      {
        $addFields: {
          distance: {
            $ifNull: ['$distance', '$minLocationData.distance'],
          },
          matchedLocation: {
            $ifNull: ['$matchedLocation', '$minLocationData.location'],
          },
        },
      },
    ];
  }
}

module.exports = new FoodTruckService();
