const express = require('express');
const multer = require('multer');
const admin = require('./firebase');
const { verifyToken } = require('./middleware');

const router = express.Router();

// Configure multer for file uploads with a 100MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

const db = admin.firestore();
const storage = admin.storage();

// POST /survey/upload - Public endpoint to upload a survey video
router.post('/upload', upload.single('video'), async (req, res) => {
  console.log('Received POST request to /survey/upload');
  console.log('Request Headers:', req.headers);
  console.log('Request Body:', req.body);
  console.log('File Present:', !!req.file);

  try {
    // Extract metadata from the request body
    const { campaignId, firstName, lastName, email, score } = req.body;
    console.log('Extracted Metadata:', { campaignId, firstName, lastName, email, score });

    // Validate required fields
    if (!campaignId) {
      console.log('Validation Failed: campaignId is required');
      return res.status(400).json({ error: 'campaignId is required' });
    }
    if (!req.file) {
      console.log('Validation Failed: Video file is required');
      return res.status(400).json({ error: 'Video file is required' });
    }
    console.log('File Details:', {
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    // Verify the campaign exists
    console.log('Verifying campaign existence for campaignId:', campaignId);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.log('Campaign not found for campaignId:', campaignId);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    console.log('Campaign exists:', campaignDoc.data());

    // Create a new document in surveyVideos collection
    const videoData = {
      campaignId,
      firstName: firstName || '',
      lastName: lastName || '',
      email: email || '',
      score: score ? parseFloat(score) : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    console.log('Creating new surveyVideos document with data:', videoData);
    const videoRef = await db.collection('surveyVideos').add(videoData);
    const videoId = videoRef.id;
    console.log('Created surveyVideos document with ID:', videoId);

    // Upload the video to Google Cloud Storage
    const bucket = storage.bucket();
    const fileName = `videos/${campaignId}/${videoId}.mp4`;
    console.log('Uploading video to GCS:', fileName);
    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: {
        contentType: 'video/mp4'
      },
    });

    stream.on('error', (err) => {
      console.error('Error uploading to GCS:', err);
      res.status(500).json({ error: 'Failed to upload video' });
    });

    stream.on('finish', async () => {
      console.log('Video uploaded to GCS successfully');
      const videoUrl = `gs://${bucket.name}/${fileName}`;
      console.log('Updating surveyVideos document with videoUrl:', videoUrl);
      await videoRef.update({ videoUrl });
      console.log('SurveyVideos document updated successfully');
      res.status(201).json({
        message: 'Video uploaded successfully',
        videoId,
      });
    });

    console.log('Starting video upload stream to GCS');
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
    console.error('Error in upload endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /survey/videos/:campaignId - Authenticated endpoint to retrieve videos for a campaign
router.get('/videos/:campaignId', verifyToken, async (req, res) => {
  console.log('Received GET request to /survey/videos/:campaignId');
  console.log('Campaign ID:', req.params.campaignId);
  console.log('User ID from token:', req.user.uid);

  try {
    const userId = req.user.uid;
    const campaignId = req.params.campaignId;

    console.log('Verifying campaign ownership for campaignId:', campaignId);
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.log('Campaign not found for campaignId:', campaignId);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    console.log('Campaign data:', campaignData);
    if (campaignData.userId !== userId) {
      console.log('Forbidden: User does not own this campaign');
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }

    console.log('Querying surveyVideos for campaignId:', campaignId);
    const snapshot = await db.collection('surveyVideos')
      .where('campaignId', '==', campaignId)
      .get();
    console.log('Found', snapshot.size, 'videos');

    const videos = [];
    for (const doc of snapshot.docs) {
      const videoData = doc.data();
      const videoId = doc.id;
      console.log('Processing video ID:', videoId);

      const file = storage.bucket().file(`videos/${campaignId}/${videoId}.mp4`);
      console.log('Generating signed URL for:', `videos/${campaignId}/${videoId}.mp4`);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
      });
      console.log('Signed URL generated:', url);

      videos.push({
        id: videoId,
        ...videoData,
        videoUrl: url,
      });
    }

    console.log('Returning videos:', videos.length);
    res.status(200).json(videos);
  } catch (error) {
    console.error('Error in get videos endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;