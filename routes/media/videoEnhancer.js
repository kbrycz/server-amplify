/**
 * Video Enhancer API
 *
 * This module handles endpoints related to video enhancement:
 * - Uploading a raw video and initiating processing via Shotstack.
 * - Retrieving enhanced videos and their statuses.
 * - Retrieving and counting AI‑generated (processed) videos.
 * - Deleting videos (both raw enhanced videos and AI‑generated ones).
 *
 * Endpoints:
 *   POST /upload
 *     - Public endpoint to upload a raw video for enhancement.
 *   DELETE /:videoId
 *     - Delete an enhanced video and its associated files.
 *   GET /
 *     - Retrieve all enhanced videos for the authenticated user.
 *   GET /status/:videoId
 *     - Check the status of a video enhancement job (legacy endpoint).
 *
 *   GET /ai-videos/campaign/:campaignId/count
 *     - Count AI‑generated videos for a specific campaign.
 *   GET /ai-videos
 *     - Retrieve all AI‑generated videos for the authenticated user.
 *   GET /ai-videos/campaign/:campaignId
 *     - Retrieve all AI‑generated videos for a specific campaign.
 *   DELETE /ai-videos/:aiVideoId
 *     - Delete an AI‑generated video.
 *
 * @example
 *   // Upload a video:
 *   curl -X POST -F "video=@/path/to/video.mp4" \
 *        http://yourdomain.com/videoEnhancer/upload
 *
 *   // Delete an enhanced video:
 *   curl -X DELETE -H "Authorization: Bearer YOUR_TOKEN" \
 *        http://yourdomain.com/videoEnhancer/abc123
 *
 *   // Get AI video count for a campaign:
 *   curl -H "Authorization: Bearer YOUR_TOKEN" \
 *        http://yourdomain.com/videoEnhancer/ai-videos/campaign/abc123/count
 */

const express = require('express');
const multer = require('multer');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const axios = require('axios');
const { logActivity } = require('../../utils/activityLogger');

const router = express.Router();

// Configure multer for file uploads (max 500MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const db = admin.firestore();
const storage = admin.storage();

// Shotstack API Configuration
const SHOTSTACK_API_KEY = process.env.SHOTSTACK_API_KEY;
const SHOTSTACK_API_URL = 'https://api.shotstack.io/edit/stage/render';
const SHOTSTACK_STATUS_URL = 'https://api.shotstack.io/edit/stage/render/';

/**
 * Helper: Generate a signed URL for a Firebase Storage file.
 *
 * @param {string} filePath - The path of the file in the bucket.
 * @returns {Promise<string>} - A signed URL valid for 15 minutes.
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
 * POST /upload
 * Uploads a raw video for enhancement and initiates processing with Shotstack.
 *
 * Expects a "video" file along with metadata in the request body.
 */
router.post('/upload', verifyToken, upload.single('video'), async (req, res) => {
  console.info('[INFO] POST /upload - Received survey video upload request');
  if (!req.file) {
    console.warn('[WARN] Video file is required');
    return res.status(400).json({ error: 'Video file is required' });
  }

  const userId = req.user.uid;
  const { desiredLength, transitionEffect, captionText, backgroundMusic, outputResolution } = req.body;

  let videoId;
  try {
    // Check user exists and has sufficient credits
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.warn(`[WARN] User not found for userId: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();
    if ((userData.credits || 0) < 1) {
      console.warn(`[WARN] Insufficient credits for userId: ${userId}`);
      return res.status(403).json({ error: 'Insufficient credits' });
    }

    // Verify campaign existence via campaignId in metadata (assumed provided within survey video data)
    const { campaignId } = req.body;
    console.info(`[INFO] Verifying campaign existence for campaignId: ${campaignId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    const campaignUserId = campaignData.userId;
    if (!campaignUserId) {
      console.error('[ERROR] Campaign does not have an associated userId');
      return res.status(500).json({ error: 'Campaign does not have an associated userId' });
    }

    // Create a new document in surveyVideos collection
    const videoData = {
      campaignId,
      userId: campaignUserId,
      firstName: req.body.firstName || '',
      lastName: req.body.lastName || '',
      email: req.body.email || '',
      zipCode: req.body.zipCode || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    console.info('[INFO] Creating surveyVideos document with data:', videoData);
    const videoRef = await db.collection('surveyVideos').add(videoData);
    videoId = videoRef.id;
    console.info(`[INFO] Created surveyVideos document with ID: ${videoId}`);

    // Upload raw video to Cloud Storage
    const bucket = storage.bucket();
    const fileName = `videos/${campaignId}/${videoId}.mp4`;
    console.info(`[INFO] Uploading video to GCS: ${fileName}`);
    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: { contentType: req.file.mimetype },
    });
    stream.on('error', (err) => {
      console.error('[ERROR] Error uploading to GCS:', err);
      return res.status(500).json({ error: 'Failed to upload video' });
    });
    stream.on('finish', async () => {
      console.info('[INFO] Video uploaded to GCS successfully');
      const videoUrl = `gs://${bucket.name}/${fileName}`;
      console.info(`[INFO] Updating surveyVideos document with videoUrl: ${videoUrl}`);
      await videoRef.update({ videoUrl });
      console.info('[INFO] SurveyVideos document updated successfully');
      return res.status(201).json({ message: 'Video uploaded successfully', videoId });
    });
    console.info('[INFO] Starting video upload stream to GCS');
    stream.end(req.file.buffer);
  } catch (error) {
    console.error('[ERROR] Error in /upload endpoint:', error.message);
    if (videoId) {
      await db.collection('enhancerVideos').doc(videoId).update({
        status: 'failed',
        error: error.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    // Assume createAlert is available in this module context if needed.
    return res.status(500).json({ error: 'Failed to initiate video processing', message: error.message });
  }
});

/**
 * DELETE /:videoId
 * Deletes an enhanced video and its associated files.
 */
router.delete('/:videoId', verifyToken, async (req, res) => {
  console.info(`[INFO] DELETE /:videoId - Request to delete video ${req.params.videoId}`);
  const userId = req.user.uid;
  const videoId = req.params.videoId;
  try {
    const videoRef = db.collection('enhancerVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.warn(`[WARN] Video not found for videoId: ${videoId}`);
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = videoDoc.data();
    if (videoData.userId !== userId) {
      console.warn(`[WARN] User ${userId} not authorized to delete video ${videoId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this video' });
    }
    const bucket = storage.bucket();
    const gsPrefix = `gs://${bucket.name}/`;
    // Delete raw video file if exists
    if (videoData.videoUrl && videoData.videoUrl.startsWith(gsPrefix)) {
      const filePath = videoData.videoUrl.substring(gsPrefix.length);
      const file = bucket.file(filePath);
      try {
        await file.delete();
        console.info(`[INFO] Deleted raw video file: ${filePath}`);
      } catch (err) {
        console.error('[ERROR] Error deleting raw video file:', err.message);
      }
    }
    // Delete processed video file if exists
    if (videoData.processedVideoUrl && videoData.processedVideoUrl.startsWith(gsPrefix)) {
      const filePath = videoData.processedVideoUrl.substring(gsPrefix.length);
      const file = bucket.file(filePath);
      try {
        await file.delete();
        console.info(`[INFO] Deleted processed video file: ${filePath}`);
      } catch (err) {
        console.error('[ERROR] Error deleting processed video file:', err.message);
      }
    }
    await videoRef.delete();
    console.info(`[INFO] Deleted enhancerVideos document: ${videoId}`);
    await logActivity(userId, 'video_enhancer_deleted', `Deleted video enhancement: ${videoData.title || 'Untitled Video'}`, { videoId });
    // Optionally create an alert here.
    return res.status(200).json({ message: 'Video deleted successfully', videoId });
  } catch (error) {
    console.error('[ERROR] Error deleting video:', error.message);
    return res.status(500).json({ error: 'Failed to delete video', message: error.message });
  }
});

/**
 * GET /
 * Retrieve all enhanced videos for the authenticated user.
 */
router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  console.info(`[INFO] GET / - Fetching enhanced videos for user: ${userId}`);
  try {
    const snapshot = await db.collection('enhancerVideos')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    const videos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.info(`[INFO] Retrieved ${videos.length} enhanced videos for user: ${userId}`);
    return res.status(200).json(videos);
  } catch (error) {
    console.error('[ERROR] Error fetching enhanced videos:', error.message);
    return res.status(500).json({ error: 'Failed to retrieve enhanced videos', message: error.message });
  }
});

/**
 * GET /status/:videoId
 * Legacy endpoint to check the status of a video enhancement job.
 */
router.get('/status/:videoId', verifyToken, async (req, res) => {
  const videoId = req.params.videoId;
  const userId = req.user.uid;
  console.info(`[INFO] GET /status/${videoId} - Checking legacy processing status`);
  try {
    const aiVideoSnapshot = await db.collection('aiVideos')
      .where('originalVideoId', '==', videoId)
      .limit(1)
      .get();
    if (!aiVideoSnapshot.empty) {
      console.info('[INFO] Video already processed; returning completed status');
      return res.status(200).json({
        status: 'completed',
        aiVideoId: aiVideoSnapshot.docs[0].id,
        processedVideoUrl: aiVideoSnapshot.docs[0].data().processedVideoUrl,
      });
    }
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.warn(`[WARN] Video not found for videoId: ${videoId}`);
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} not authorized to access campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    // Check for failure alert
    const failureAlertSnapshot = await db.collection('alerts')
      .where('userId', '==', userId)
      .where('alertType', '==', 'enhancement_failure')
      .where('extraData.videoId', '==', videoId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (!failureAlertSnapshot.empty) {
      console.info(`[INFO] Found failure alert for videoId: ${videoId}`);
      return res.status(200).json({
        status: 'failed',
        error: failureAlertSnapshot.docs[0].data().message || 'Processing failed',
      });
    }
    // Estimate progress
    const lastUpdated = videoData.updatedAt ? videoData.updatedAt.toDate() : new Date();
    const now = new Date();
    const elapsedMs = now - lastUpdated;
    const estimatedTotalMs = 2 * 60 * 1000;
    const progress = Math.min(elapsedMs / estimatedTotalMs, 0.99);
    console.info(`[INFO] Estimated progress for videoId: ${videoId} is ${progress}`);
    return res.status(200).json({
      status: 'processing',
      progress,
      estimatedTimeRemaining: Math.max(0, estimatedTotalMs - elapsedMs),
    });
  } catch (error) {
    console.error('[ERROR] Error checking legacy processing status:', error.message);
    return res.status(500).json({
      status: 'unknown',
      error: 'Failed to check processing status',
      message: error.message,
    });
  }
});

/**
 * GET /ai-videos/campaign/:campaignId/count
 * Count AI‑generated videos for a specific campaign.
 */
router.get('/ai-videos/campaign/:campaignId/count', verifyToken, async (req, res) => {
  console.info(`[INFO] GET /ai-videos/campaign/${req.params.campaignId}/count - Received request`);
  const { campaignId } = req.params;
  const userId = req.user.uid;
  console.info(`[INFO] Campaign ID: ${campaignId}, User ID: ${userId}`);
  try {
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
    const snapshot = await db.collection('aiVideos')
      .where('campaignId', '==', campaignId)
      .get();
    const count = snapshot.size;
    console.info(`[INFO] Found AI video count: ${count}`);
    return res.status(200).json({ count });
  } catch (error) {
    console.error('[ERROR] Error counting AI videos:', error);
    return res.status(500).json({ error: 'Failed to count AI videos', message: error.message });
  }
});

/**
 * GET /ai-videos
 * Retrieve all processed AI‑generated videos for the authenticated user.
 */
router.get('/ai-videos', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  console.info(`[INFO] GET /ai-videos - Fetching AI videos for user: ${userId}`);
  try {
    const snapshot = await db.collection('aiVideos')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    const aiVideos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.info(`[INFO] Found ${aiVideos.length} AI videos for user: ${userId}`);
    return res.status(200).json(aiVideos);
  } catch (error) {
    console.error('[ERROR] Error retrieving AI videos:', error);
    return res.status(500).json({ error: 'Failed to retrieve AI videos', message: error.message });
  }
});

/**
 * GET /ai-videos/campaign/:campaignId
 * Retrieve all processed AI‑generated videos for a specific campaign.
 */
router.get('/ai-videos/campaign/:campaignId', verifyToken, async (req, res) => {
  const { campaignId } = req.params;
  const userId = req.user.uid;
  console.info(`[INFO] GET /ai-videos/campaign/${campaignId} - Fetching AI videos for campaign and user: ${userId}`);
  try {
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
    const snapshot = await db.collection('aiVideos')
      .where('campaignId', '==', campaignId)
      .orderBy('createdAt', 'desc')
      .get();
    const aiVideos = await Promise.all(snapshot.docs.map(async (doc) => {
      const videoData = doc.data();
      const filePath = videoData.processedVideoUrl?.replace(`gs://${storage.bucket().name}/`, '');
      const signedUrl = filePath ? await generateSignedUrl(filePath) : null;
      return { id: doc.id, ...videoData, processedVideoUrl: signedUrl || videoData.processedVideoUrl };
    }));
    console.info(`[INFO] Found ${aiVideos.length} AI videos for campaign: ${campaignId}`);
    return res.status(200).json(aiVideos);
  } catch (error) {
    console.error('[ERROR] Error retrieving AI videos for campaign:', error);
    return res.status(500).json({ error: 'Failed to retrieve AI videos', message: error.message });
  }
});

/**
 * GET /status/:videoId
 * Legacy endpoint: Check the status of a video processing job.
 */
router.get('/status/:videoId', verifyToken, async (req, res) => {
  const videoId = req.params.videoId;
  const userId = req.user.uid;
  console.info(`[INFO] GET /status/${videoId} - Checking legacy status`);
  try {
    const aiVideoSnapshot = await db.collection('aiVideos')
      .where('originalVideoId', '==', videoId)
      .limit(1)
      .get();
    if (!aiVideoSnapshot.empty) {
      console.info('[INFO] Video already processed; returning completed status');
      return res.status(200).json({
        status: 'completed',
        aiVideoId: aiVideoSnapshot.docs[0].id,
        processedVideoUrl: aiVideoSnapshot.docs[0].data().processedVideoUrl,
      });
    }
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.warn(`[WARN] Video not found for videoId: ${videoId}`);
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;
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
    const failureAlertSnapshot = await db.collection('alerts')
      .where('userId', '==', userId)
      .where('alertType', '==', 'enhancement_failure')
      .where('extraData.videoId', '==', videoId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (!failureAlertSnapshot.empty) {
      console.info(`[INFO] Found failure alert for videoId: ${videoId}`);
      return res.status(200).json({
        status: 'failed',
        error: failureAlertSnapshot.docs[0].data().message || 'Processing failed',
      });
    }
    const lastUpdated = videoData.updatedAt ? videoData.updatedAt.toDate() : new Date();
    const now = new Date();
    const elapsedMs = now - lastUpdated;
    const estimatedTotalMs = 2 * 60 * 1000;
    const progress = Math.min(elapsedMs / estimatedTotalMs, 0.99);
    console.info(`[INFO] Estimated progress for videoId: ${videoId} is ${progress}`);
    return res.status(200).json({
      status: 'processing',
      progress,
      estimatedTimeRemaining: Math.max(0, estimatedTotalMs - elapsedMs),
    });
  } catch (error) {
    console.error('[ERROR] Error checking legacy status:', error.message);
    return res.status(500).json({
      status: 'unknown',
      error: 'Failed to check processing status',
      message: error.message,
    });
  }
});

/**
 * DELETE /ai-videos/:aiVideoId
 * Delete an AI-generated video.
 */
router.delete('/ai-videos/:aiVideoId', verifyToken, async (req, res) => {
  const aiVideoId = req.params.aiVideoId;
  const userId = req.user.uid;
  console.info(`[INFO] DELETE /ai-videos/${aiVideoId} - Received request from user: ${userId}`);
  try {
    const aiVideoRef = db.collection('aiVideos').doc(aiVideoId);
    const aiVideoDoc = await aiVideoRef.get();
    if (!aiVideoDoc.exists) {
      console.warn(`[WARN] AI video not found for ID: ${aiVideoId}`);
      return res.status(404).json({ error: 'AI video not found' });
    }
    const aiVideoData = aiVideoDoc.data();
    const campaignId = aiVideoData.campaignId;
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} not authorized to delete AI video for campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    await aiVideoRef.delete();
    console.info(`[INFO] Deleted AI video document with ID: ${aiVideoId}`);
    const processedVideoUrl = aiVideoData.processedVideoUrl;
    if (processedVideoUrl) {
      const bucket = storage.bucket();
      const fileName = processedVideoUrl.replace(`gs://${bucket.name}/`, '');
      const file = bucket.file(fileName);
      try {
        await file.delete();
        console.info(`[INFO] Deleted processed video file: ${fileName}`);
      } catch (deleteError) {
        console.error('[ERROR] Error deleting processed video file:', deleteError.message);
      }
    }
    return res.status(200).json({ message: 'AI video deleted successfully' });
  } catch (error) {
    console.error('[ERROR] Error deleting AI video:', error.message);
    return res.status(500).json({ error: 'Failed to delete AI video', message: error.message });
  }
});

module.exports = router;