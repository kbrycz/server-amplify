/**
 * Thumbnail Endpoint API
 *
 * This module provides an endpoint to generate a thumbnail image from a video.
 * It downloads the video stream from the given URL, captures a frame at 1 second,
 * and streams the resulting JPEG image back to the client.
 *
 * Endpoint:
 *   GET /thumbnailEndpoint?videoUrl=<VIDEO_URL>
 *
 * @example
 *   curl "http://yourdomain.com/thumbnailEndpoint?videoUrl=https://example.com/path/to/video.mp4"
 */

const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');

// Set the path to ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

router.get('/', async (req, res) => {
  console.info('[INFO] GET /thumbnailEndpoint - Received request');
  try {
    const { videoUrl } = req.query;
    if (!videoUrl) {
      console.warn('[WARN] Missing videoUrl query parameter');
      return res.status(400).json({ error: 'Missing videoUrl query parameter' });
    }

    console.info(`[INFO] Fetching video stream from URL: ${videoUrl}`);
    const response = await axios.get(videoUrl, { responseType: 'stream' });
    const videoStream = response.data;

    // Set response header to image/jpeg
    res.setHeader('Content-Type', 'image/jpeg');

    console.info('[INFO] Capturing thumbnail using ffmpeg');
    const proc = ffmpeg(videoStream)
      .setStartTime('00:00:01')
      .frames(1)
      .outputOptions('-qscale:v', '2')
      .format('image2pipe');

    proc.pipe(res, { end: true });
    proc.on('error', (err) => {
      console.error('[ERROR] ffmpeg error:', err);
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Error generating thumbnail' });
      }
    });
  } catch (error) {
    console.error('[ERROR] Error in GET /thumbnailEndpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;