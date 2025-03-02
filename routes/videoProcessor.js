// process-video.js
const express = require('express');
const admin = require('../firebase');
const { verifyToken } = require('../middleware');
const axios = require('axios');
const router = express.Router();

const db = admin.firestore();
const storage = admin.storage();

// Shotstack API Configuration
const SHOTSTACK_API_KEY = process.env.SHOTSTACK_API_KEY || 'fZYrhQ2UoW3yERhBahVEeFzTOrnbFig5r2UtQJjH';
const SHOTSTACK_API_URL = 'https://api.shotstack.io/edit/stage/render';
const SHOTSTACK_STATUS_URL = 'https://api.shotstack.io/edit/stage/render/';

/**
 * Helper function to generate a signed URL for a Firebase Storage file.
 */
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

/**
 * Helper function to get video duration (placeholder; replace with actual implementation).
 */
async function getVideoDuration(videoUrl) {
  try {
    // Placeholder: assumes 2 minutes. For production, use ffprobe or similar
    return 120; // 120 seconds
  } catch (error) {
    console.error('Error checking video duration:', error);
    throw new Error('Failed to determine video duration');
  }
}

/**
 * Helper function to create an alert/notification document.
 */
async function createAlert(userId, alertType, message, extraData = {}) {
  try {
    await db.collection('alerts').add({
      userId,
      alertType,
      message,
      extraData,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Error creating alert:', err);
  }
}

// POST /process-video - Process a video into a polished short
router.post('/process-video', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { videoId, desiredLength, transitionEffect, captionText, backgroundMusic, outputResolution } = req.body;

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
    const gsPrefix = 'gs://amplify-dev-6b1c7.firebasestorage.app/';
    if (!videoGsUrl.startsWith(gsPrefix)) {
      console.log('Invalid video URL format:', videoGsUrl);
      return res.status(400).json({ error: 'Invalid video URL format' });
    }
    const filePath = videoGsUrl.substring(gsPrefix.length);
    console.log('Extracted file path:', filePath);
    const signedUrl = await generateSignedUrl(filePath);

    // Check video duration
    const videoDuration = await getVideoDuration(signedUrl);
    console.log('Video duration (seconds):', videoDuration);

    // Define the clip length for Shotstack
    const clipLength = Math.min(videoDuration, desiredLength || 60);
    console.log('Using clip length (seconds):', clipLength);

    // Determine audio source, replacing the problematic Shotstack URL
    let audioSrc = backgroundMusic;
    if (!audioSrc || audioSrc === 'https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/music/freepd/effects.mp3') {
      audioSrc = 'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/freepd/motions.mp3';
    }

    // Shotstack template with user-specified parameters
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
                  volume: 0, // Mute the video's audio to use background music
                },
                start: 0,
                length: clipLength,
                transition: {
                  in: transitionEffect || 'fade',
                },
              },
            ],
          },
          {
            clips: [
              {
                asset: {
                  type: 'audio',
                  src: audioSrc,
                },
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
                transition: {
                  in: transitionEffect || 'fade',
                },
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
                transition: {
                  in: 'slideUp',
                },
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
                transition: {
                  in: transitionEffect || 'fade',
                },
              },
            ],
          },
          {
            clips: [
              {
                asset: {
                  type: 'image',
                  src: 'https://shotstack-ingest-api-v1-sources.s3.ap-southeast-2.amazonaws.com/wzr6y0wtti/zzz01jh6-tp5k4-9e22c-dszkp-wa727z/source.jpg',
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
        size: {
          width: 1080,
          height: 1920,
        },
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
        `${SHOTSTACK_STATUS_URL}${renderId}`,
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

    console.log('Processed video URL from Shotstack:', processedVideoUrl);

    // Download the video from Shotstack
    const videoResponse = await axios.get(processedVideoUrl, { responseType: 'arraybuffer' });
    const videoBuffer = Buffer.from(videoResponse.data);

    // Upload the video to Google Cloud Storage in a new 'processed' folder
    const bucket = storage.bucket();
    const fileName = `processed/${campaignId}/${renderId}.mp4`; // New folder 'processed'
    console.log('Uploading processed video to GCS:', fileName);
    const file = bucket.file(fileName);
    await file.save(videoBuffer, {
      metadata: {
        contentType: 'video/mp4',
      },
    });

    // Get the permanent URL for the uploaded video
    const permanentUrl = `gs://${bucket.name}/${fileName}`;
    console.log('Processed video uploaded to GCS:', permanentUrl);

    // Save the permanent URL to Firestore
    const aiVideoData = {
      userId,
      campaignId,
      originalVideoId: videoId,
      processedVideoUrl: permanentUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    console.log('Creating new aiVideos document with data:', aiVideoData);
    const aiVideoRef = await db.collection('aiVideos').add(aiVideoData);
    console.log('Created aiVideos document with ID:', aiVideoRef.id);

    // Create a success alert for the user
    await createAlert(userId, 'enhancement_success', 'Your video has been enhanced successfully.', { videoId, renderId, processedVideoUrl: permanentUrl });

    res.status(201).json({
      message: 'Video processed successfully',
      aiVideoId: aiVideoRef.id,
      processedVideoUrl: permanentUrl,
    });
  } catch (error) {
    console.error('Error in process-video endpoint:', error.message);
    // Create a failure alert for the user
    try {
      await createAlert(req.user.uid, 'enhancement_failure', `Video enhancement failed: ${error.message}`, { videoId });
    } catch (alertErr) {
      console.error('Error creating failure alert:', alertErr.message);
    }
    if (error.response) {
      console.error('Shotstack API error response:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(500).json({ error: 'Failed to process video', message: error.message });
  }
});

// GET /ai-videos/campaign/:campaignId/count - Count AI-generated videos for a campaign
router.get('/ai-videos/campaign/:campaignId/count', verifyToken, async (req, res) => {
  console.log('Received GET request to /videoProcessor/ai-videos/campaign/:campaignId/count');
  const { campaignId } = req.params;
  const userId = req.user.uid;
  console.log('Campaign ID:', campaignId);
  console.log('User ID from token:', userId);

  try {
    // Verify campaign existence and ownership
    console.log('Verifying campaign existence and ownership for campaignId:', campaignId);
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

    console.log('Counting AI videos for campaignId:', campaignId);
    const snapshot = await db.collection('aiVideos')
      .where('campaignId', '==', campaignId)
      .get();

    const count = snapshot.size;
    console.log('Found AI video count:', count);
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error counting AI videos:', error);
    res.status(500).json({ error: 'Failed to count AI videos', message: error.message });
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

// GET /ai-videos/campaign/:campaignId - Retrieve all processed videos for a specific campaign
router.get('/ai-videos/campaign/:campaignId', verifyToken, async (req, res) => {
  const { campaignId } = req.params;
  const userId = req.user.uid;
  console.log('Fetching aiVideos for campaign:', campaignId, 'and user:', userId);

  try {
    // Verify campaign existence and ownership
    console.log('Verifying campaign existence and ownership for campaignId:', campaignId);
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

    console.log('Querying aiVideos for campaignId:', campaignId);
    const snapshot = await db.collection('aiVideos')
      .where('campaignId', '==', campaignId)
      .get();

    const aiVideos = await Promise.all(snapshot.docs.map(async (doc) => {
      const videoData = doc.data();
      const filePath = videoData.processedVideoUrl.replace(`gs://${storage.bucket().name}/`, '');
      const signedUrl = await generateSignedUrl(filePath);
      return {
        id: doc.id,
        ...videoData,
        processedVideoUrl: signedUrl, // Replace gs:// URL with signed URL for playback
      };
    }));

    console.log(`Found ${aiVideos.length} aiVideos for campaignId: ${campaignId}`);
    res.status(200).json(aiVideos);
  } catch (error) {
    console.error('Error in get ai-videos/campaign endpoint:', error);
    res.status(500).json({ error: 'Failed to retrieve AI videos', message: error.message });
  }
});

module.exports = router;