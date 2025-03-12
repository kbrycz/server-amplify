/**
 * Survey API
 *
 * This module handles survey video uploads and retrieval for campaigns.
 *
 * Endpoints:
 *   POST /survey/upload
 *     - Public endpoint to upload a survey video along with metadata.
 *   GET /survey/videos/:campaignId
 *     - Authenticated endpoint to retrieve survey videos for a specific campaign,
 *       sorted by creation time in descending order.
 *   GET /survey/videos/:campaignId/count
 *     - Authenticated endpoint to count the survey videos for a specific campaign.
 *   GET /survey/video/:videoId
 *     - Authenticated endpoint to retrieve a specific survey video by its video ID.
 *
 * @example
 *   // Upload a survey video:
 *   curl -X POST -F "video=@/path/to/video.mp4" -F "campaignId=abc123" \
 *        -F "firstName=John" -F "lastName=Doe" http://yourdomain.com/survey/upload
 *
 *   // Retrieve videos:
 *   curl -H "Authorization: Bearer YOUR_TOKEN" http://yourdomain.com/survey/videos/abc123
 *
 *   // Get video count:
 *   curl -H "Authorization: Bearer YOUR_TOKEN" http://yourdomain.com/survey/videos/abc123/count
 *
 *   // Get a single video:
 *   curl -H "Authorization: Bearer YOUR_TOKEN" http://yourdomain.com/survey/video/xyz789
 */

const express = require('express');
const multer = require('multer');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');

const router = express.Router();

// Configure multer for file uploads with a 100MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const db = admin.firestore();
const storage = admin.storage();

/**
 * POST /survey/upload
 * Public endpoint to upload a survey video.
 * Expects a "video" file along with metadata such as campaignId, firstName, etc.
 */
router.post('/upload', upload.single('video'), async (req, res) => {
  console.info('[INFO] POST /survey/upload - Received request');
  console.debug('[DEBUG] Request Headers:', req.headers);
  console.debug('[DEBUG] Request Body:', req.body);
  console.debug('[DEBUG] File Present:', !!req.file);

  try {
    // Extract metadata from the request body
    const { campaignId, firstName, lastName, email, zipCode } = req.body;
    console.info(`[INFO] Extracted Metadata: campaignId=${campaignId}, firstName=${firstName}, lastName=${lastName}, email=${email}, zipCode=${zipCode}`);

    // Validate required fields
    if (!campaignId) {
      console.warn('[WARN] campaignId is required');
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!req.file) {
      console.warn('[WARN] Video file is required');
      return res.status(400).json({ error: 'Video file is required' });
    }
    console.info('[INFO] File Details:', {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    // Verify the campaign exists
    console.info(`[INFO] Verifying campaign existence for campaignId: ${campaignId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    console.info('[INFO] Campaign exists:', campaignDoc.data());

    // Get the userId from the campaign
    const campaignData = campaignDoc.data();
    const userId = campaignData.userId;
    if (!userId) {
      console.error('[ERROR] Campaign does not have an associated userId');
      return res.status(500).json({ error: 'Campaign does not have an associated userId' });
    }

    // Create a new document in surveyVideos collection with new fields for enhanced video
    const videoData = {
      campaignId,
      userId,
      firstName: firstName || '',
      lastName: lastName || '',
      email: email || '',
      zipCode: zipCode || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isVideoEnhanced: false,  // Default set to false
      videoEnhancedUrl: ''     // Default empty string
    };
    console.info('[INFO] Creating new surveyVideos document with data:', videoData);
    const videoRef = await db.collection('surveyVideos').add(videoData);
    const videoId = videoRef.id;
    console.info(`[INFO] Created surveyVideos document with ID: ${videoId}`);

    // Upload the video to Google Cloud Storage
    const bucket = storage.bucket();
    const fileName = `videos/${campaignId}/${videoId}.mp4`;
    console.info(`[INFO] Uploading video to GCS: ${fileName}`);
    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: { contentType: 'video/mp4' }
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
      return res.status(201).json({
        message: 'Video uploaded successfully',
        videoId
      });
    });

    console.info('[INFO] Starting video upload stream to GCS');
    stream.end(req.file.buffer);
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        console.warn('[WARN] File too large (max 100MB)');
        return res.status(400).json({ error: 'File too large (max 100MB)' });
      }
      console.error('[ERROR] Multer error:', error.message);
      return res.status(400).json({ error: 'Multer error: ' + error.message });
    }
    console.error('[ERROR] Error in /survey/upload endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /survey/videos/:campaignId
 * Authenticated endpoint to retrieve survey videos for a campaign.
 * Returns videos sorted by createdAt in descending order.
 */
router.get('/videos/:campaignId', verifyToken, async (req, res) => {
  console.info('[INFO] GET /survey/videos/:campaignId - Received request');
  const campaignId = req.params.campaignId;
  const userId = req.user.uid;
  console.info(`[INFO] Campaign ID: ${campaignId}, User ID: ${userId}`);

  try {
    // Verify campaign ownership
    console.info(`[INFO] Verifying campaign ownership for campaignId: ${campaignId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} does not own campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    console.info(`[INFO] Querying surveyVideos for campaignId: ${campaignId}`);
    const snapshot = await db.collection('surveyVideos')
      .where('campaignId', '==', campaignId)
      .orderBy('createdAt', 'desc')
      .get();
    console.info(`[INFO] Found ${snapshot.size} videos`);

    const videos = [];
    for (const doc of snapshot.docs) {
      const videoData = doc.data();
      const videoId = doc.id;
      console.info(`[INFO] Processing video ID: ${videoId}`);

      const file = storage.bucket().file(`videos/${campaignId}/${videoId}.mp4`);
      console.info(`[INFO] Generating signed URL for: videos/${campaignId}/${videoId}.mp4`);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000 // 1 hour expiry
      });
      console.info(`[INFO] Signed URL generated: ${url}`);

      videos.push({
        id: videoId,
        ...videoData,
        videoUrl: url
      });
    }

    console.info(`[INFO] Returning ${videos.length} videos`);
    return res.status(200).json(videos);
  } catch (error) {
    console.error('[ERROR] Error in GET /survey/videos/:campaignId endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /survey/videos/:campaignId/count
 * Authenticated endpoint to count survey videos for a campaign.
 */
router.get('/videos/:campaignId/count', verifyToken, async (req, res) => {
  console.info('[INFO] GET /survey/videos/:campaignId/count - Received request');
  const { campaignId } = req.params;
  const userId = req.user.uid;
  console.info(`[INFO] Campaign ID: ${campaignId}, User ID: ${userId}`);

  try {
    // Verify campaign existence and ownership
    console.info(`[INFO] Verifying campaign existence for campaignId: ${campaignId}`);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} does not own campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    console.info(`[INFO] Counting videos for campaignId: ${campaignId}`);
    const snapshot = await db.collection('surveyVideos')
      .where('campaignId', '==', campaignId)
      .get();

    const count = snapshot.size;
    console.info(`[INFO] Found video count: ${count}`);
    return res.status(200).json({ count });
  } catch (error) {
    console.error('[ERROR] Error counting videos:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /survey/video/:videoId
 * Authenticated endpoint to retrieve a specific survey video by its video ID.
 */
router.get('/video/:videoId', verifyToken, async (req, res) => {
  console.info('[INFO] GET /survey/video/:videoId - Received request');
  const videoId = req.params.videoId;
  const userId = req.user.uid;

  try {
    // Fetch the video document
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.warn(`[WARN] Video not found for videoId: ${videoId}`);
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = videoDoc.data();

    // Verify campaign ownership by checking the associated campaign
    const campaignRef = db.collection('campaigns').doc(videoData.campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for videoId: ${videoId}`);
      return res.status(404).json({ error: 'Campaign not found for this video' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} is not authorized to access video ${videoId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this video' });
    }

    // Generate a signed URL for the video file from Cloud Storage
    const bucket = storage.bucket();
    const fileName = `videos/${videoData.campaignId}/${videoId}.mp4`;
    const file = bucket.file(fileName);
    console.info(`[INFO] Generating signed URL for: ${fileName}`);
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000 // 1 hour expiry
    });
    console.info(`[INFO] Signed URL generated: ${signedUrl}`);

    return res.status(200).json({
      id: videoId,
      ...videoData,
      videoUrl: signedUrl
    });
  } catch (error) {
    console.error('[ERROR] Error fetching single survey video:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

/**
 * GET /survey/videos/enhanced/count
 * Authenticated endpoint to count survey videos that have been enhanced.
 * It filters documents where isVideoEnhanced is true.
 */
router.get('/videos/enhanced/count', verifyToken, async (req, res) => {
  console.info('[INFO] GET /survey/videos/enhanced/count - Received request');
  const userId = req.user.uid;
  try {
    // Query surveyVideos for documents where 'isVideoEnhanced' is true
    const snapshot = await db.collection('surveyVideos')
      .where('userId', '==', userId)
      .where('isVideoEnhanced', '==', true)
      .get();
    const count = snapshot.size;
    console.info(`[INFO] Found ${count} enhanced videos for user ${userId}`);
    return res.status(200).json({ count });
  } catch (error) {
    console.error('[ERROR] Error counting enhanced videos:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;