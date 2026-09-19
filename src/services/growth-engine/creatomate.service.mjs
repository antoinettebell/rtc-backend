const CREATOMATE_API_URL = 'https://api.creatomate.com/v2/renders';

const TEMPLATE_IDS = {
  vendorSpotlight: '288befc3-2dab-4724-b857-51685da78e2f',
};

function getApiKey() {
  const apiKey = process.env.CREATOMATE_API_KEY;

  if (!apiKey) {
    throw new Error('Missing CREATOMATE_API_KEY environment variable.');
  }

  return apiKey;
}

export async function renderVendorSpotlight({
  scene1VideoUrl,
  scene2VideoUrl,
  scene3VideoUrl,
  hook,
  productText,
  ctaText,
  musicUrl,
}) {
  const apiKey = getApiKey();

  if (!scene1VideoUrl) {
    throw new Error('scene1VideoUrl is required.');
  }

  if (!scene2VideoUrl) {
    throw new Error('scene2VideoUrl is required.');
  }

  if (!scene3VideoUrl) {
    throw new Error('scene3VideoUrl is required.');
  }

  if (!hook) {
    throw new Error('hook is required.');
  }

  if (!productText) {
    throw new Error('productText is required.');
  }

  if (!ctaText) {
    throw new Error('ctaText is required.');
  }

  if (!musicUrl) {
    throw new Error('musicUrl is required.');
  }

  const payload = {
    template_id: TEMPLATE_IDS.vendorSpotlight,

    modifications: {
      'Scene_1_Video.source': scene1VideoUrl,
      'Hook.text': hook,

      'Scene_2_Video.source': scene2VideoUrl,
      'Product_Text.text': productText,

      'Scene_3_Video.source': scene3VideoUrl,
      'CTA_Text.text': ctaText,

      'Music.source': musicUrl,
    },
  };

  const response = await fetch(CREATOMATE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      `Creatomate render request failed with status ${response.status}.`;

    throw new Error(message);
  }

  return {
    id: result.id,
    status: result.status,
    url: result.url,
    templateId: result.template_id,
    templateName: result.template_name,
    outputFormat: result.output_format,
    modifications: result.modifications,
  };
}
