/**
 * Video Editor API
 *
 * This module provides endpoints for updating, modifying metadata, and deleting survey videos.
 *
 * Endpoints:
 *   POST /videoEditor/update-video/:videoId
 *     - Upload a new version of an existing video, overwriting the current file.
 *   PUT /videoEditor/update-metadata/:videoId
 *     - Update video metadata (e.g., star a video).
 *   DELETE /videoEditor/delete/:videoId
 *     - Delete a video file from Firebase Storage and remove its document from Firestore.
 *
 * @example
 *   // Update video file:
 *   curl -X POST -H "Authorization: Bearer YOUR_TOKEN" -F "video=@/path/to/newvideo.mp4" \
 *        http://yourdomain.com/videoEditor/update-video/abc123
 *
 *   // Update video metadata:
 *   curl -X PUT -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
 *        -d '{"starred": true}' http://yourdomain.com/videoEditor/update-metadata/abc123
 *
 *   // Delete a video:
 *   curl -X DELETE -H "Authorization: Bearer YOUR_TOKEN" http://yourdomain.com/videoEditor/delete/abc123
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
 * POST /videoEditor/update-video/:videoId
 * Upload a new version of an existing video.
 * Overwrites the video file in Firebase Storage and updates the Firestore document.
 */
router.post('/update-video/:videoId', verifyToken, upload.single('video'), async (req, res) => {
  console.info('[INFO] POST /videoEditor/update-video - Received update request');
  console.info(`[INFO] Video ID: ${req.params.videoId}, User ID: ${req.user.uid}`);
  console.debug('[DEBUG] File Present:', !!req.file);

  try {
    const userId = req.user.uid;
    const videoId = req.params.videoId;

    // Check if the video exists in Firestore
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
      console.warn(`[WARN] User ${userId} is not authorized to update video in campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    // Validate file existence
    if (!req.file) {
      console.warn('[WARN] Video file is required');
      return res.status(400).json({ error: 'Video file is required' });
    }
    console.info('[INFO] File Details:', {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    // Upload new video to Firebase Storage (overwrite existing file)
    const bucket = storage.bucket();
    const fileName = `videos/${campaignId}/${videoId}.mp4`;
    console.info(`[INFO] Uploading updated video to Firebase Storage: ${fileName}`);
    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: { contentType: 'video/mp4' }
    });

    stream.on('error', (err) => {
      console.error('[ERROR] Error uploading updated video:', err);
      return res.status(500).json({ error: 'Failed to upload updated video' });
    });

    stream.on('finish', async () => {
      console.info('[INFO] Updated video uploaded successfully');
      const videoUrl = `gs://${bucket.name}/${fileName}`;
      console.info(`[INFO] Updating Firestore document with new videoUrl: ${videoUrl}`);
      await videoRef.update({
        videoUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.info('[INFO] Firestore document updated successfully');
      return res.status(200).json({
        message: 'Video updated successfully',
        videoId
      });
    });

    console.info('[INFO] Starting updated video upload stream');
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
    console.error('[ERROR] Error in update-video endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /videoEditor/update-metadata/:videoId
 * Update video metadata (e.g., starring a video).
 * Expects a JSON body with a boolean "starred" field.
 */
router.put('/update-metadata/:videoId', verifyToken, async (req, res) => {
  console.info('[INFO] PUT /videoEditor/update-metadata - Received request');
  console.info(`[INFO] Video ID: ${req.params.videoId}, User ID: ${req.user.uid}`);
  console.debug('[DEBUG] Request Body:', req.body);

  try {
    const userId = req.user.uid;
    const videoId = req.params.videoId;
    const { starred } = req.body;

    // Validate the "starred" field
    if (typeof starred !== 'boolean') {
      console.warn('[WARN] "starred" field must be a boolean');
      return res.status(400).json({ error: 'starred field must be a boolean' });
    }

    // Check if the video exists in Firestore
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
      console.warn(`[WARN] User ${userId} is not authorized to update metadata for campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    // Update the "starred" field
    console.info(`[INFO] Updating "starred" field for videoId: ${videoId} to: ${starred}`);
    await videoRef.update({
      starred,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.info('[INFO] Video metadata updated successfully');
    return res.status(200).json({
      message: 'Video metadata updated successfully',
      videoId
    });
  } catch (error) {
    console.error('[ERROR] Error in update-metadata endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /videoEditor/delete/:videoId
 * Delete a video.
 * Removes the video file from Firebase Storage and deletes the corresponding Firestore document.
 */
router.delete('/delete/:videoId', verifyToken, async (req, res) => {
  console.info('[INFO] DELETE /videoEditor/delete - Received request');
  console.info(`[INFO] Video ID: ${req.params.videoId}, User ID: ${req.user.uid}`);

  try {
    const userId = req.user.uid;
    const videoId = req.params.videoId;

    // Check if the video exists in Firestore
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
      console.warn(`[WARN] User ${userId} is not authorized to delete video from campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    // Delete the video file from Firebase Storage
    const bucket = storage.bucket();
    const fileName = `videos/${campaignId}/${videoId}.mp4`;
    console.info(`[INFO] Deleting video from Firebase Storage: ${fileName}`);
    const file = bucket.file(fileName);
    await file.delete();
    console.info('[INFO] Video file deleted from Firebase Storage successfully');

    // Delete the video document from Firestore
    console.info(`[INFO] Deleting Firestore document for videoId: ${videoId}`);
    await videoRef.delete();
    console.info('[INFO] Video document deleted successfully');

    return res.status(200).json({
      message: 'Video deleted successfully',
      videoId
    });
  } catch (error) {
    console.error('[ERROR] Error in DELETE /videoEditor/delete endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;