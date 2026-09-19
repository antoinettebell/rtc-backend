import { fal } from '@fal-ai/client';

const VIDEO_MODEL =
  'fal-ai/kling-video/v3/turbo/pro/image-to-video';

const MUSIC_MODEL =
  'fal-ai/elevenlabs/music';

function configureFal() {
  const apiKey = process.env.FAL_KEY;

  if (!apiKey) {
    throw new Error('Missing FAL_KEY environment variable.');
  }

  fal.config({
    credentials: apiKey,
  });
}

export async function generateVendorVideo({
  imageUrl,
  prompt,
  duration = '5',
}) {
  if (!imageUrl) {
    throw new Error('imageUrl is required.');
  }

  if (!prompt) {
    throw new Error('prompt is required.');
  }

  configureFal();

  const result = await fal.subscribe(VIDEO_MODEL, {
    input: {
      image_url: imageUrl,
      prompt,
      duration,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') {
        update.logs
          ?.map((log) => log.message)
          .filter(Boolean)
          .forEach((message) =>
            console.log(`[fal video] ${message}`)
          );
      }
    },
  });

  const video = result?.data?.video;

  if (!video?.url) {
    throw new Error('fal.ai did not return a video URL.');
  }

  return {
    requestId: result.requestId,
    url: video.url,
    contentType: video.content_type,
    fileName: video.file_name,
    fileSize: video.file_size,
  };
}

export async function generateCampaignMusic({
  prompt,
  durationMs = 15000,
  forceInstrumental = true,
}) {
  if (!prompt) {
    throw new Error('prompt is required.');
  }

  if (durationMs < 3000 || durationMs > 600000) {
    throw new Error(
      'durationMs must be between 3000 and 600000.'
    );
  }

  configureFal();

  const result = await fal.subscribe(MUSIC_MODEL, {
    input: {
      prompt,
      music_length_ms: durationMs,
      force_instrumental: forceInstrumental,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') {
        update.logs
          ?.map((log) => log.message)
          .filter(Boolean)
          .forEach((message) =>
            console.log(`[fal music] ${message}`)
          );
      }
    },
  });

  const audio = result?.data?.audio;

  if (!audio?.url) {
    throw new Error('fal.ai did not return an audio URL.');
  }

  return {
    requestId: result.requestId,
    url: audio.url,
    contentType: audio.content_type,
    fileName: audio.file_name,
    fileSize: audio.file_size,
  };
}
