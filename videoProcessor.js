const express = require('express');
const admin = require('./firebase');
const { verifyToken } = require('./middleware');
const axios = require('axios');
const router = express.Router();

const db = admin.firestore();
const storage = admin.storage();

// Shotstack API Configuration
const SHOTSTACK_API_KEY = process.env.SHOTSTACK_API_KEY || 'fZYrhQ2UoW3yERhBahVEeFzTOrnbFig5r2UtQJjH';
const SHOTSTACK_API_URL = 'https://api.shotstack.io/edit/stage/render';

// Utility function to generate a signed URL for a Firebase Storage file
async function generateSignedUrl(filePath) {
  console.log('Generating signed URL for file:', filePath);
  try {
    const file = storage.bucket().file(filePath);
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // URL valid for 15 minutes
      version: 'v4',
    });
    console.log('Signed URL generated:', signedUrl);
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error('Failed to generate signed URL for video');
  }
}

// Utility function to get video duration (placeholder; replace with actual implementation)
async function getVideoDuration(videoUrl) {
  try {
    // Placeholder: assumes 2 minutes. For production, use ffprobe or similar to get actual duration
    return 120; // 120 seconds
  } catch (error) {
    console.error('Error checking video duration:', error);
    throw new Error('Failed to determine video duration');
  }
}

// POST /process-video - Process a video into a polished short
router.post('/process-video', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { videoId } = req.body;

  if (!videoId) {
    console.log('Validation Failed: videoId is required');
    return res.status(400).json({ error: 'videoId is required' });
  }

  try {
    console.log('Fetching video with ID:', videoId);
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.log('Video not found for videoId:', videoId);
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;
    console.log('Associated campaignId:', campaignId);

    // Verify campaign ownership
    console.log('Verifying campaign ownership for campaignId:', campaignId);
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

    // Get the video URL from Firebase Storage and generate a signed URL
    const videoGsUrl = videoData.videoUrl; // gs:// URL
    console.log('Original video URL:', videoGsUrl);

    // Extract the file path from the gs:// URL
    const gsPrefix = 'gs://amplify-dev-6b1c7.firebasestorage.app/';
    if (!videoGsUrl.startsWith(gsPrefix)) {
      console.log('Invalid video URL format:', videoGsUrl);
      return res.status(400).json({ error: 'Invalid video URL format' });
    }
    const filePath = videoGsUrl.substring(gsPrefix.length);
    console.log('Extracted file path:', filePath);

    // Generate a signed URL for the video
    const signedUrl = await generateSignedUrl(filePath);

    // Check video duration
    const videoDuration = await getVideoDuration(signedUrl);
    console.log('Video duration (seconds):', videoDuration);

    // Define the clip length for Shotstack (max 60 seconds for a short)
    const desiredLength = 60;
    const clipLength = Math.min(videoDuration, desiredLength);
    console.log('Using clip length (seconds):', clipLength);

    // Enhanced Shotstack template for a polished, cool-themed short
    const shotstackTemplate = {
      timeline: {
        tracks: [
          {
            clips: [
              {
                asset: {
                  type: 'video',
                  src: signedUrl,
                  trim: 0,
                },
                start: 0,
                length: clipLength,
                effect: 'zoomInSlow', // Smoother zoom effect
                filter: [
                  { effect: 'brightness', value: 0.5 }, // Brighten the dark video
                  { effect: 'contrast', value: 0.3 },   // Increase contrast
                  { effect: 'colorGrade', options: { teal: 0.3, orange: 0.3 } } // Trendy color grading
                ],
              },
            ],
          },
          {
            clips: [
              {
                asset: {
                  type: 'audio',
                  src: 'https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/music/freepd/effects.mp3', // Upbeat background music
                },
                start: 0,
                length: clipLength,
                volume: 0.5,
              },
            ],
          },
          {
            clips: [
              {
                asset: {
                  type: 'title',
                  text: 'Discover Something Cool!',
                  style: 'minimal',
                  size: 'large',
                  position: 'center',
                  color: '#ffffff',
                  background: { color: '#000000', opacity: 0.5 },
                },
                start: 0,
                length: 5,
                effect: 'fadeIn', // Animated caption entry
              },
              {
                asset: {
                  type: 'title',
                  text: 'Feel the Vibe!',
                  style: 'minimal',
                  size: 'medium',
                  position: 'bottom',
                  color: '#ffcc00', // Bright yellow for pop
                  background: { color: '#000000', opacity: 0.5 },
                },
                start: 5,
                length: 10,
                effect: 'slideUp', // Dynamic slide-up effect
              },
              {
                asset: {
                  type: 'title',
                  text: 'Join Now!',
                  style: 'minimal',
                  size: 'large',
                  position: 'center',
                  color: '#ff0000', // Bold red CTA
                  background: { color: '#000000', opacity: 0.5 },
                },
                start: clipLength - 5,
                length: 5,
                effect: 'fadeIn',
              },
            ],
          },
          {
            clips: [
              {
                asset: {
                  type: 'image',
                  src: 'https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/overlays/neon-border.png', // Neon overlay for cool theme
                },
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
        resolution: '1080x1920', // Vertical format for shorts
      },
    };

    console.log('Sending request to Shotstack API with template:', JSON.stringify(shotstackTemplate, null, 2));
    const shotstackResponse = await axios.post(
      SHOTSTACK_API_URL,
      shotstackTemplate,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SHOTSTACK_API_KEY,
        },
      }
    );

    console.log('Shotstack API Response:', JSON.stringify(shotstackResponse.data, null, 2));

    if (!shotstackResponse.data.success) {
      console.log('Shotstack API failed:', shotstackResponse.data.message);
      throw new Error(`Shotstack API failed to initiate render: ${shotstackResponse.data.message}`);
    }

    const renderId = shotstackResponse.data.response.id;
    console.log('Shotstack render initiated, renderId:', renderId);

    // Poll for render completion
    let renderStatus;
    let processedVideoUrl;
    let pollAttempts = 0;
    const maxAttempts = 60; // 5 minutes (60 * 5 seconds)

    do {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      pollAttempts++;
      console.log(`Polling Shotstack render status, attempt ${pollAttempts}/${maxAttempts}`);
      const statusResponse = await axios.get(
        `https://api.shotstack.io/edit/stage/render/${renderId}`,
        {
          headers: { 'x-api-key': SHOTSTACK_API_KEY },
        }
      );
      console.log('Shotstack render status response:', JSON.stringify(statusResponse.data, null, 2));
      renderStatus = statusResponse.data.response.status;
      if (renderStatus === 'done') {
        processedVideoUrl = statusResponse.data.response.url;
      } else if (renderStatus === 'failed') {
        throw new Error(`Shotstack render failed: ${statusResponse.data.response.error || 'Unknown error'}`);
      }
      console.log('Shotstack render status:', renderStatus);
      if (pollAttempts >= maxAttempts) {
        throw new Error('Shotstack render timed out after maximum attempts');
      }
    } while (renderStatus !== 'done');

    console.log('Processed video URL:', processedVideoUrl);

    const aiVideoData = {
      userId,
      originalVideoId: videoId,
      processedVideoUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    console.log('Creating new aiVideos document with data:', aiVideoData);
    const aiVideoRef = await db.collection('aiVideos').add(aiVideoData);
    console.log('Created aiVideos document with ID:', aiVideoRef.id);

    res.status(201).json({
      message: 'Video processed successfully',
      aiVideoId: aiVideoRef.id,
      processedVideoUrl,
    });
  } catch (error) {
    console.error('Error in process-video endpoint:', error.message);
    if (error.response) {
      console.error('Shotstack API error response:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(500).json({ error: 'Failed to process video', message: error.message });
  }
});

// GET /ai-videos - Retrieve all processed videos for the user
router.get('/ai-videos', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  console.log('Fetching aiVideos for user:', userId);

  try {
    const snapshot = await db.collection('aiVideos')
      .where('userId', '==', userId)
      .get();

    const aiVideos = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    console.log(`Found ${aiVideos.length} aiVideos`);

    res.status(200).json(aiVideos);
  } catch (error) {
    console.error('Error in get ai-videos endpoint:', error);
    res.status(500).json({ error: 'Failed to retrieve aiVideos', message: error.message });
  }
});

module.exports = router;