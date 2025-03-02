// thumbnailEndpoint.js
const express = require('express');
const router = express.Router();
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');

// Set the path to ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * GET /thumbnailEndpoint?videoUrl=<VIDEO_URL>
 * Downloads the video stream from the provided URL, extracts a thumbnail image
 * (using the frame at 1 second into the video), and streams the JPEG back to the client.
 */
router.get('/', async (req, res) => {
  try {
    const { videoUrl } = req.query;
    if (!videoUrl) {
      return res.status(400).json({ error: 'Missing videoUrl query parameter' });
    }

    // Get the video stream from the URL
    const response = await axios.get(videoUrl, { responseType: 'stream' });
    const videoStream = response.data;

    // Set response header to image/jpeg so the client can render it
    res.setHeader('Content-Type', 'image/jpeg');

    // Use ffmpeg to capture one frame (at 1 second into the video)
    const proc = ffmpeg(videoStream)
      .setStartTime('00:00:01')
      .frames(1)
      .outputOptions('-qscale:v', '2') // quality (lower is better)
      .format('image2pipe');

    // Pipe the output directly to the response
    proc.pipe(res, { end: true });

    proc.on('error', (err) => {
      console.error('ffmpeg error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error generating thumbnail' });
      }
    });
  } catch (error) {
    console.error('Error in thumbnail endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;