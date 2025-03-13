/**
 * Survey API
 *
 * This module handles survey video uploads and retrieval for campaigns.
 * In a namespace-based design, multiple users can share a campaign. Therefore,
 * we check the campaign's namespace and see if the requesting user has permission there,
 * rather than checking only if (campaignData.userId === userId).
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
 *   GET /survey/videos/enhanced/count
 *     - Authenticated endpoint to count how many videos are “enhanced”.
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

// ------------------------------------------------------
// Helper function to check user permission in a namespace
// ------------------------------------------------------
async function getUserPermission(namespaceId, userEmail) {
  // If namespaceId doesn't exist or userEmail is missing, return null
  if (!namespaceId || !userEmail) return null;

  const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
  if (!nsDoc.exists) return null;

  const nsData = nsDoc.data();
  if (!nsData.members) return null;

  // Find member in the namespace with matching email (case-insensitive) and status active
  const member = nsData.members.find(m =>
    m.email.toLowerCase() === userEmail.toLowerCase() && m.status === 'active'
  );

  // Return e.g. 'admin', 'read/write', 'readonly' or null if none
  return member ? member.permission : null;
}

// ------------------------------------------------------
// POST /survey/upload  (Public endpoint)
// ------------------------------------------------------
router.post('/upload', upload.single('video'), async (req, res) => {
  console.info('[INFO] POST /survey/upload - Received request');
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
    const userId = campaignData.createdBy || campaignData.userId; // If you use userId or createdBy
    if (!userId) {
      console.error('[ERROR] Campaign does not have an associated userId/createdBy');
      return res.status(500).json({ error: 'Campaign does not have an associated userId' });
    }

    // Create a new document in surveyVideos
    const videoData = {
      campaignId,
      userId, // This is the original owner's userId. If you want to store differently, adjust accordingly.
      firstName: firstName || '',
      lastName: lastName || '',
      email: email || '',
      zipCode: zipCode || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isVideoEnhanced: false,
      videoEnhancedUrl: ''
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

// ------------------------------------------------------
// GET /survey/videos/:campaignId
// Authenticated endpoint to retrieve survey videos for a campaign.
// We now rely on the campaign's namespace to see if the user has permission.
// ------------------------------------------------------
router.get('/videos/:campaignId', verifyToken, async (req, res) => {
  try {
    console.info('[INFO] GET /survey/videos/:campaignId - Received request');
    const campaignId = req.params.campaignId;
    const userEmail = req.user.email;

    // Retrieve the campaign to get its namespaceId
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (!campaignData.namespaceId) {
      console.error('[ERROR] Campaign has no namespaceId (namespace-based sharing not possible).');
      return res.status(500).json({ error: 'Campaign missing namespaceId' });
    }

    // Check user's permission in that namespace
    const permission = await getUserPermission(campaignData.namespaceId, userEmail);
    if (!permission) {
      // Or if you want only "read/write" or "admin" to read, that's up to your policy
      // if (!['read/write','admin'].includes(permission)) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission in this namespace' });
    }

    // If permissible, fetch survey videos
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

      // Generate a signed URL for the video in Cloud Storage
      const file = storage.bucket().file(`videos/${campaignId}/${videoId}.mp4`);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000 // 1 hour expiry
      });

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
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ------------------------------------------------------
// GET /survey/videos/:campaignId/count
// Authenticated endpoint to count survey videos for a campaign.
// Using the same namespace-based approach as above.
// ------------------------------------------------------
router.get('/videos/:campaignId/count', verifyToken, async (req, res) => {
  try {
    console.info('[INFO] GET /survey/videos/:campaignId/count - Received request');
    const campaignId = req.params.campaignId;
    const userEmail = req.user.email;

    // Retrieve the campaign to see if user has permission
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (!campaignData.namespaceId) {
      return res.status(500).json({ error: 'Campaign missing namespaceId' });
    }

    // Check permission in that namespace
    const permission = await getUserPermission(campaignData.namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission in this namespace' });
    }

    // Count videos
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

// ------------------------------------------------------
// GET /survey/video/:videoId
// Authenticated endpoint to retrieve a single survey video doc
// We'll fetch its campaign, do the same namespace-based check,
// then generate a signed URL for the video file
// ------------------------------------------------------
router.get('/video/:videoId', verifyToken, async (req, res) => {
  try {
    console.info('[INFO] GET /survey/video/:videoId - Received request');
    const videoId = req.params.videoId;
    const userEmail = req.user.email;

    // Fetch the video doc
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = videoDoc.data();

    // Verify the associated campaign
    const campaignRef = db.collection('campaigns').doc(videoData.campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      return res.status(404).json({ error: 'Campaign not found for this video' });
    }
    const campaignData = campaignDoc.data();

    if (!campaignData.namespaceId) {
      return res.status(500).json({ error: 'Campaign missing namespaceId' });
    }

    // Check user's permission in that namespace
    const permission = await getUserPermission(campaignData.namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission in this namespace' });
    }

    // Generate a signed URL for the video file from Cloud Storage
    const bucket = storage.bucket();
    const fileName = `videos/${videoData.campaignId}/${videoId}.mp4`;
    const file = bucket.file(fileName);
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000 // 1 hour expiry
    });

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

// ------------------------------------------------------
// GET /survey/videos/enhanced/count
// Authenticated endpoint to count all “enhanced” videos belonging to the user
// If you want it to be namespace-based, you’d do a separate approach or
// query the user’s membership. The logic below is the old approach that checks userId.
// You can adapt it to do an “in array of possible userId’s” or do a namespace filter.
// ------------------------------------------------------
router.get('/videos/enhanced/count', verifyToken, async (req, res) => {
  console.info('[INFO] GET /survey/videos/enhanced/count - Received request');
  const userId = req.user.uid;

  try {
    // Query surveyVideos for documents where 'isVideoEnhanced' is true
    // You might want to do a join with the campaign’s namespace or user membership
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