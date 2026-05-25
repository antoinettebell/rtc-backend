const { BannerModel: Model, BannerAdEventModel } = require('../../models');
const { BaseService } = require('../../common-services');

const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'snapchat.com',
  'pinterest.com',
  'threads.net',
];

const buildError = (message, code = 409) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const isSocialHost = (host) =>
  SOCIAL_HOSTS.some((socialHost) => {
    const normalized = String(host || '').toLowerCase();
    return normalized === socialHost || normalized.endsWith(`.${socialHost}`);
  });

class BannerService extends BaseService {
  constructor() {
    super(Model);
  }

  async getAdMetricsByBannerIds(bannerIds = []) {
    const ids = bannerIds.filter(Boolean);
    if (!ids.length) {
      return {};
    }

    const rows = await BannerAdEventModel.aggregate([
      {
        $match: {
          banner_id: { $in: ids },
        },
      },
      {
        $group: {
          _id: {
            banner_id: '$banner_id',
            event_type: '$event_type',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    return rows.reduce((acc, row) => {
      const bannerId = row._id.banner_id.toString();
      acc[bannerId] = acc[bannerId] || {
        adImpressions: 0,
        adClicks: 0,
        adClickThroughRate: 0,
      };

      if (row._id.event_type === 'IMPRESSION') {
        acc[bannerId].adImpressions = row.count;
      }

      if (row._id.event_type === 'CLICK') {
        acc[bannerId].adClicks = row.count;
      }

      return acc;
    }, {});
  }

  async attachAdMetrics(banners) {
    const list = Array.isArray(banners) ? banners : [banners].filter(Boolean);
    const metricsById = await this.getAdMetricsByBannerIds(
      list.map((banner) => banner._id)
    );

    const withMetrics = list.map((banner) => {
      const plain =
        typeof banner.toObject === 'function' ? banner.toObject() : banner;
      const metrics = metricsById[plain._id.toString()] || {
        adImpressions: 0,
        adClicks: 0,
        adClickThroughRate: 0,
      };
      const adClickThroughRate =
        metrics.adImpressions > 0
          ? Number(((metrics.adClicks / metrics.adImpressions) * 100).toFixed(2))
          : 0;

      return {
        ...plain,
        ...metrics,
        adClickThroughRate,
      };
    });

    return Array.isArray(banners) ? withMetrics : withMetrics[0] || null;
  }

  sanitizeDestinationUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return null;
    }

    if (/[\u0000-\u001F\u007F\s]/.test(raw)) {
      throw buildError('Ad destination URL is invalid.');
    }

    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? raw
      : `https://${raw}`;

    let parsed;
    try {
      parsed = new URL(candidate);
    } catch (e) {
      throw buildError('Ad destination URL is invalid.');
    }

    if (parsed.protocol !== 'https:') {
      throw buildError('Ad destination URL must use https://.');
    }

    if (!parsed.hostname || parsed.username || parsed.password) {
      throw buildError('Ad destination URL is invalid.');
    }

    if (!raw.toLowerCase().startsWith('https://') && !isSocialHost(parsed.hostname)) {
      throw buildError(
        'Ad destination URL must include https:// unless it is a recognized social media URL.'
      );
    }

    parsed.hash = parsed.hash || '';
    return parsed.toString();
  }

  async recordAdEvent({ bannerId, eventType }) {
    const banner = await this.getById(bannerId);
    if (!banner || banner.deletedAt || !banner.isActive) {
      return null;
    }

    const now = new Date();
    if (
      (banner.fromDate && new Date(banner.fromDate) > now) ||
      (banner.toDate && new Date(banner.toDate) < now)
    ) {
      return null;
    }

    return BannerAdEventModel.create({
      banner_id: banner._id,
      ad_vendor_id: banner._id,
      event_type: eventType,
      timestamp: now,
    });
  }
}

module.exports = new BannerService();
