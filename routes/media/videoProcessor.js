/**
 * Video Processor API
 *
 * This module processes a raw video into a polished short using the Shotstack API.
 * It also provides endpoints to check the status of the processing job.
 *
 * Endpoints:
 *   POST /process-video
 *     - Initiates processing of a raw video (identified by videoId) using Shotstack.
 *   GET /status/job/:aiVideoId
 *     - Check the status of a specific video processing job.
 *
 * @example
 *   // Process a video:
 *   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{"videoId": "abc123", "desiredLength": 60, ...}' \
 *        http://yourdomain.com/videoProcessor/process-video
 *
 *   // Check processing status:
 *   curl -H "Authorization: Bearer YOUR_TOKEN" http://yourdomain.com/videoProcessor/status/job/def456
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const axios = require('axios');
const router = express.Router();

const db = admin.firestore();
const storage = admin.storage();

// Shotstack API Configuration
const SHOTSTACK_API_KEY = process.env.SHOTSTACK_API_KEY;
const SHOTSTACK_API_URL = 'https://api.shotstack.io/edit/stage/render';
const SHOTSTACK_STATUS_URL = 'https://api.shotstack.io/edit/stage/render/';

/**
 * Helper: Generate a signed URL for a Firebase Storage file.
 *
 * @param {string} filePath - The file path in the bucket.
 * @returns {Promise<string>} - The signed URL.
 */
async function generateSignedUrl(filePath) {
  console.info(`[INFO] Generating signed URL for file: ${filePath}`);
  try {
    const file = storage.bucket().file(filePath);
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
      version: 'v4',
    });
    console.info(`[INFO] Signed URL generated: ${signedUrl}`);
    return signedUrl;
  } catch (error) {
    console.error('[ERROR] Error generating signed URL:', error);
    throw new Error('Failed to generate signed URL for video');
  }
}

/**
 * Helper: Get video duration.
 * (This is a placeholder; in production, use a proper method like ffprobe.)
 *
 * @param {string} videoUrl - The signed URL of the video.
 * @returns {Promise<number>} - Duration in seconds.
 */
async function getVideoDuration(videoUrl) {
  try {
    // Placeholder value: 120 seconds
    return 120;
  } catch (error) {
    console.error('[ERROR] Error checking video duration:', error);
    throw new Error('Failed to determine video duration');
  }
}

/**
 * Helper: Create an alert document.
 *
 * @param {string} userId - The user ID.
 * @param {string} alertType - The type of alert.
 * @param {string} message - The alert message.
 * @param {Object} [extraData={}] - Extra data for the alert.
 */
async function createAlert(userId, alertType, message, extraData = {}) {
  try {
    await db.collection('alerts').add({
      userId,
      alertType,
      message,
      extraData,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[ERROR] Error creating alert:', err);
  }
}

/**
 * POST /process-video
 * Process a video into a polished short using the Shotstack API.
 *
 * Expects a JSON body with:
 *   - videoId: ID of the raw video in surveyVideos.
 *   - desiredLength, transitionEffect, captionText, backgroundMusic, outputResolution.
 *
 * Responds immediately with the AI video ID and processes the video in the background.
 */
router.post('/process-video', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { videoId, desiredLength, transitionEffect, captionText, backgroundMusic, outputResolution } = req.body;

  if (!videoId) {
    console.warn('[WARN] videoId is required');
    return res.status(400).json({ error: 'videoId is required' });
  }

  try {
    // Check user's credits
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.warn(`[WARN] User not found for userId: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();
    if (typeof userData.credits !== 'number' || userData.credits < 1) {
      console.warn(`[WARN] Insufficient credits for userId: ${userId}`);
      return res.status(403).json({ error: 'Insufficient credits' });
    }

    console.info(`[INFO] Fetching raw video with ID: ${videoId}`);
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.warn(`[WARN] Video not found for videoId: ${videoId}`);
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;
    console.info(`[INFO] Associated campaignId: ${campaignId}`);

    // Verify campaign ownership
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} not authorized for campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    // Create a new document in aiVideos collection with status 'processing'
    const aiVideoData = {
      userId,
      campaignId,
      originalVideoId: videoId,
      status: 'processing',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const aiVideoRef = await db.collection('aiVideos').add(aiVideoData);
    const aiVideoId = aiVideoRef.id;
    console.info(`[INFO] Created aiVideos document with ID: ${aiVideoId}`);

    // Respond immediately with processing status
    res.status(202).json({ message: 'Processing started', aiVideoId });

    // Background processing
    setImmediate(async () => {
      try {
        // Generate signed URL for the raw video
        const videoGsUrl = videoData.videoUrl;
        console.info(`[INFO] Raw video URL: ${videoGsUrl}`);
        const gsPrefix = 'gs://amplify-dev-6b1c7.firebasestorage.app/';
        if (!videoGsUrl.startsWith(gsPrefix)) {
          console.error('[ERROR] Invalid video URL format:', videoGsUrl);
          throw new Error('Invalid video URL format');
        }
        const filePath = videoGsUrl.substring(gsPrefix.length);
        console.info(`[INFO] Extracted file path: ${filePath}`);
        const signedUrl = await generateSignedUrl(filePath);

        // Get video duration
        const videoDuration = await getVideoDuration(signedUrl);
        console.info(`[INFO] Video duration: ${videoDuration} seconds`);

        // Determine clip length
        const clipLength = Math.min(videoDuration, Number(desiredLength) || 60);
        console.info(`[INFO] Using clip length: ${clipLength} seconds`);

        // Determine audio source
        let audioSrc = backgroundMusic;
        if (!audioSrc || audioSrc === 'https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/music/freepd/effects.mp3') {
          audioSrc = 'https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/music/freepd/motions.mp3';
        }

        // Build Shotstack template
        const shotstackTemplate = {
          timeline: {
            tracks: [
              {
                clips: [
                  {
                    asset: { type: 'video', src: signedUrl, trim: 0, volume: 0 },
                    start: 0,
                    length: clipLength,
                    transition: { in: transitionEffect || 'fade' },
                  },
                ],
              },
              {
                clips: [
                  {
                    asset: { type: 'audio', src: audioSrc },
                    start: 0,
                    length: clipLength,
                  },
                ],
              },
              {
                clips: [
                  {
                    asset: {
                      type: 'title',
                      text: captionText || 'Discover Something Cool!',
                      style: 'minimal',
                      size: 'large',
                      position: 'center',
                      color: '#ffffff',
                      background: '#000000',
                    },
                    start: 0,
                    length: 5,
                    transition: { in: transitionEffect || 'fade' },
                  },
                  {
                    asset: {
                      type: 'title',
                      text: 'Feel the Vibe!',
                      style: 'minimal',
                      size: 'medium',
                      position: 'bottom',
                      color: '#ffcc00',
                      background: '#000000',
                    },
                    start: 5,
                    length: 10,
                    transition: { in: 'slideUp' },
                  },
                  {
                    asset: {
                      type: 'title',
                      text: 'Join Now!',
                      style: 'minimal',
                      size: 'large',
                      position: 'center',
                      color: '#ff0000',
                      background: '#000000',
                    },
                    start: clipLength - 5,
                    length: 5,
                    transition: { in: transitionEffect || 'fade' },
                  },
                ],
              },
              {
                clips: [
                  {
                    asset: { type: 'image', src: 'https://shotstack-ingest-api-v1-sources.s3.ap-southeast-2.amazonaws.com/wzr6y0wtti/zzz01jh6-tp5k4-9e22c-dszkp-wa727z/source.jpg' },
                    start: 0,
                    length: clipLength,
                    opacity: 0.8,
                    position: 'center',
                  },
                ],
              },
            ],
          },
          output: {
            format: 'mp4',
            size: {
              width: outputResolution ? Number(outputResolution.split('x')[0]) : 1080,
              height: outputResolution ? Number(outputResolution.split('x')[1]) : 1920,
            },
          },
        };

        console.info('[INFO] Sending request to Shotstack API with template:', JSON.stringify(shotstackTemplate, null, 2));
        const shotstackResponse = await axios.post(
          SHOTSTACK_API_URL,
          shotstackTemplate,
          { headers: { 'Content-Type': 'application/json', 'x-api-key': SHOTSTACK_API_KEY } }
        );
        if (!shotstackResponse.data.success) {
          throw new Error(`Shotstack API failed: ${shotstackResponse.data.response.message}`);
        }
        const renderId = shotstackResponse.data.response.id;
        console.info(`[INFO] Shotstack render initiated, renderId: ${renderId}`);

        // Update aiVideos document with renderId
        await aiVideoRef.update({
          renderId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Poll for render completion
        let renderStatus;
        let processedVideoUrl;
        let pollAttempts = 0;
        const maxAttempts = 60;
        do {
          await new Promise(resolve => setTimeout(resolve, 5000));
          pollAttempts++;
          console.info(`[INFO] Polling Shotstack status: attempt ${pollAttempts}/${maxAttempts}`);
          const statusResponse = await axios.get(`${SHOTSTACK_STATUS_URL}${renderId}`, {
            headers: { 'x-api-key': SHOTSTACK_API_KEY },
          });
          renderStatus = statusResponse.data.response.status;
          if (renderStatus === 'done') {
            processedVideoUrl = statusResponse.data.response.url;
          } else if (renderStatus === 'failed') {
            throw new Error(`Shotstack render failed: ${statusResponse.data.response.error || 'Unknown error'}`);
          }
          if (pollAttempts >= maxAttempts) {
            throw new Error('Shotstack render timed out after maximum attempts');
          }
        } while (renderStatus !== 'done');

        console.info(`[INFO] Processed video URL from Shotstack: ${processedVideoUrl}`);

        // Download and upload processed video
        const videoResponse = await axios.get(processedVideoUrl, { responseType: 'arraybuffer' });
        const videoBuffer = Buffer.from(videoResponse.data);
        const bucket = storage.bucket();
        const processedFileName = `enhancerVideos/processed/${campaignId}/${renderId}.mp4`;
        const processedFile = bucket.file(processedFileName);
        await processedFile.save(videoBuffer, {
          metadata: { contentType: 'video/mp4' },
        });
        const permanentUrl = `gs://${bucket.name}/${processedFileName}`;
        console.info(`[INFO] Processed video uploaded to GCS: ${permanentUrl}`);

        // Update aiVideos document with completion details
        await aiVideoRef.update({
          status: 'completed',
          processedVideoUrl: permanentUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Deduct user credit
        await userRef.update({ credits: admin.firestore.FieldValue.increment(-1) });
        console.info('[INFO] Deducted one credit from user');

        // Log activity and create success alert
        await logActivity(userId, 'video_enhancer_processed', `Processed video: ${videoData.title}`, { videoId, renderId });
        await createAlert(userId, 'enhancement_success', 'Your video has been enhanced successfully.', {
          videoId,
          renderId,
          processedVideoUrl: permanentUrl,
        });
      } catch (error) {
        console.error('[ERROR] Background processing error:', error.message);
        await aiVideoRef.update({
          status: 'failed',
          error: error.message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await createAlert(userId, 'enhancement_failure', `Video enhancement failed: ${error.message}`, { videoId });
      }
    });
  } catch (error) {
    console.error('[ERROR] Error initiating video processing:', error.message);
    return res.status(500).json({ error: 'Failed to initiate video processing', message: error.message });
  }
});

/**
 * GET /status/job/:aiVideoId
 * Check the status of a specific video processing job.
 */
router.get('/status/job/:aiVideoId', verifyToken, async (req, res) => {
  const aiVideoId = req.params.aiVideoId;
  const userId = req.user.uid;
  console.info(`[INFO] Checking processing status for AI video ID: ${aiVideoId}`);
  try {
    const aiVideoRef = db.collection('aiVideos').doc(aiVideoId);
    const aiVideoDoc = await aiVideoRef.get();
    if (!aiVideoDoc.exists) {
      console.warn(`[WARN] AI video not found for ID: ${aiVideoId}`);
      return res.status(404).json({ error: 'AI video not found' });
    }
    const aiVideoData = aiVideoDoc.data();
    if (aiVideoData.userId !== userId) {
      console.warn(`[WARN] User ${userId} not authorized to access AI video ${aiVideoId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this AI video' });
    }
    const status = aiVideoData.status;
    if (status === 'completed') {
      return res.status(200).json({ status: 'completed', processedVideoUrl: aiVideoData.processedVideoUrl });
    } else if (status === 'failed') {
      return res.status(200).json({ status: 'failed', error: aiVideoData.error || 'Processing failed' });
    } else {
      return res.status(200).json({ status: 'processing' });
    }
  } catch (error) {
    console.error('[ERROR] Error checking processing status:', error.message);
    return res.status(500).json({
      status: 'unknown',
      error: 'Failed to check processing status',
      message: error.message,
    });
  }
});

module.exports = router;