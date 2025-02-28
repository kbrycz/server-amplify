const express = require('express');
const multer = require('multer');
const admin = require('./firebase');
const { verifyToken } = require('./middleware');

const router = express.Router();

// Configure multer for file uploads with a 100MB limit (consistent with survey.js)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

const db = admin.firestore();
const storage = admin.storage();

// POST /videoEditor/update-video/:videoId - Upload a new version of an existing video
router.post('/update-video/:videoId', verifyToken, upload.single('video'), async (req, res) => {
  console.log('Received POST request to /videoEditor/update-video/:videoId');
  console.log('Video ID:', req.params.videoId);
  console.log('User ID from token:', req.user.uid);
  console.log('File Present:', !!req.file);

  try {
    const userId = req.user.uid;
    const videoId = req.params.videoId;

    // Check if the video exists in Firestore
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.log('Video not found for videoId:', videoId);
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;
    console.log('Associated campaignId:', campaignId);

    // Verify that the user owns the campaign
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.log('Campaign not found for campaignId:', campaignId);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.log('Forbidden: User does not own this campaign');
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    // Validate the uploaded file
    if (!req.file) {
      console.log('Validation Failed: Video file is required');
      return res.status(400).json({ error: 'Video file is required' });
    }
    console.log('File Details:', {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });

    // Upload the new video to Firebase Storage, overwriting the existing file
    const bucket = storage.bucket();
    const fileName = `videos/${campaignId}/${videoId}.mp4`;
    console.log('Uploading updated video to Firebase Storage:', fileName);
    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: {
        contentType: 'video/mp4',
      },
    });

    stream.on('error', (err) => {
      console.error('Error uploading updated video to Firebase Storage:', err);
      res.status(500).json({ error: 'Failed to upload updated video' });
    });

    stream.on('finish', async () => {
      console.log('Updated video uploaded to Firebase Storage successfully');
      const videoUrl = `gs://${bucket.name}/${fileName}`;
      console.log('Updating surveyVideos document with new videoUrl:', videoUrl);
      await videoRef.update({
        videoUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('SurveyVideos document updated successfully');
      res.status(200).json({
        message: 'Video updated successfully',
        videoId,
      });
    });

    console.log('Starting updated video upload stream to Firebase Storage');
    stream.end(req.file.buffer);
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        console.log('Multer Error: File too large (max 100MB)');
        return res.status(400).json({ error: 'File too large (max 100MB)' });
      }
      console.error('Multer Error:', error.message);
      return res.status(400).json({ error: 'Multer error: ' + error.message });
    }
    console.error('Error in update-video endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /videoEditor/update-metadata/:videoId - Update video metadata (e.g., star a video)
router.put('/update-metadata/:videoId', verifyToken, async (req, res) => {
  console.log('Received PUT request to /videoEditor/update-metadata/:videoId');
  console.log('Video ID:', req.params.videoId);
  console.log('User ID from token:', req.user.uid);
  console.log('Request Body:', req.body);

  try {
    const userId = req.user.uid;
    const videoId = req.params.videoId;
    const { starred } = req.body; // Expecting a boolean for the "starred" field

    // Validate the starred field
    if (typeof starred !== 'boolean') {
      console.log('Validation Failed: starred field must be a boolean');
      return res.status(400).json({ error: 'starred field must be a boolean' });
    }

    // Check if the video exists in Firestore
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.log('Video not found for videoId:', videoId);
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;
    console.log('Associated campaignId:', campaignId);

    // Verify that the user owns the campaign
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.log('Campaign not found for campaignId:', campaignId);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.log('Forbidden: User does not own this campaign');
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    // Update the starred field in Firestore
    console.log('Updating starred field for videoId:', videoId, 'to:', starred);
    await videoRef.update({
      starred,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log('Video metadata updated successfully');
    res.status(200).json({
      message: 'Video metadata updated successfully',
      videoId,
    });
  } catch (error) {
    console.error('Error in update-metadata endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /videoEditor/delete/:videoId - Delete a video
router.delete('/delete/:videoId', verifyToken, async (req, res) => {
  console.log('Received DELETE request to /videoEditor/delete/:videoId');
  console.log('Video ID:', req.params.videoId);
  console.log('User ID from token:', req.user.uid);

  try {
    const userId = req.user.uid;
    const videoId = req.params.videoId;

    // Check if the video exists in Firestore
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.log('Video not found for videoId:', videoId);
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;
    console.log('Associated campaignId:', campaignId);

    // Verify that the user owns the campaign
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.log('Campaign not found for campaignId:', campaignId);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.log('Forbidden: User does not own this campaign');
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    // Delete the video file from Firebase Storage
    const bucket = storage.bucket();
    const fileName = `videos/${campaignId}/${videoId}.mp4`;
    console.log('Deleting video from Firebase Storage:', fileName);
    const file = bucket.file(fileName);
    await file.delete();
    console.log('Video deleted from Firebase Storage successfully');

    // Delete the video document from Firestore
    console.log('Deleting video document from Firestore:', videoId);
    await videoRef.delete();
    console.log('Video document deleted successfully');

    res.status(200).json({
      message: 'Video deleted successfully',
      videoId,
    });
  } catch (error) {
    console.error('Error in delete endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;