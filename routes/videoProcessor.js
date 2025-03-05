const express = require('express');
const admin = require('../firebase');
const { verifyToken } = require('../middleware');
const axios = require('axios');
const router = express.Router();

const db = admin.firestore();
const storage = admin.storage();

// Shotstack API Configuration
const SHOTSTACK_API_KEY = process.env.SHOTSTACK_API_KEY;
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
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
    // Check user's credits
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.log('User not found for userId:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();
    if (typeof userData.credits !== 'number' || userData.credits < 1) {
      console.log('Insufficient credits for userId:', userId);
      return res.status(403).json({ error: 'Insufficient credits' });
    }

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

    // Create aiVideos document with initial status 'processing'
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
    console.log('Created aiVideos document with ID:', aiVideoId);

    // Respond to the client immediately with the aiVideoId
    res.status(202).json({
      message: 'Processing started',
      aiVideoId,
    });

    // Process in the background
    setImmediate(async () => {
      try {
        // Get the video URL from Firebase Storage and generate a signed URL
        const videoGsUrl = videoData.videoUrl;
        console.log('Original video URL:', videoGsUrl);
        const gsPrefix = 'gs://amplify-dev-6b1c7.firebasestorage.app/';
        if (!videoGsUrl.startsWith(gsPrefix)) {
          console.log('Invalid video URL format:', videoGsUrl);
          throw new Error('Invalid video URL format');
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

        // Determine audio source
        let audioSrc = backgroundMusic;
        if (!audioSrc || audioSrc === 'https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/music/freepd/effects.mp3') {
          audioSrc = 'https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/music/freepd/motions.mp3';
        }

        // Shotstack template
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
                      volume: 0,
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

        if (!shotstackResponse.data.success) {
          throw new Error(`Shotstack API failed to initiate render: ${shotstackResponse.data.message}`);
        }

        const renderId = shotstackResponse.data.response.id;
        console.log('Shotstack render initiated, renderId:', renderId);

        // Update aiVideos with renderId
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
          await new Promise((resolve) => setTimeout(resolve, 5000));
          pollAttempts++;
          console.log(`Polling Shotstack render status, attempt ${pollAttempts}/${maxAttempts}`);
          const statusResponse = await axios.get(
            `${SHOTSTACK_STATUS_URL}${renderId}`,
            {
              headers: { 'x-api-key': SHOTSTACK_API_KEY },
            }
          );
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

        console.log('Processed video URL from Shotstack:', processedVideoUrl);

        // Download and upload video
        const videoResponse = await axios.get(processedVideoUrl, { responseType: 'arraybuffer' });
        const videoBuffer = Buffer.from(videoResponse.data);

        const bucket = storage.bucket();
        const fileName = `processed/${campaignId}/${renderId}.mp4`;
        const file = bucket.file(fileName);
        await file.save(videoBuffer, {
          metadata: {
            contentType: 'video/mp4',
          },
        });

        const permanentUrl = `gs://${bucket.name}/${fileName}`;
        console.log('Processed video uploaded to GCS:', permanentUrl);

        // Update aiVideos document with completion details
        await aiVideoRef.update({
          status: 'completed',
          processedVideoUrl: permanentUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Deduct credit
        await userRef.update({
          credits: admin.firestore.FieldValue.increment(-1),
        });

        // Create success alert
        await createAlert(userId, 'enhancement_success', 'Your video has been enhanced successfully.', {
          videoId,
          renderId,
          processedVideoUrl: permanentUrl,
        });
      } catch (error) {
        console.error('Background processing error:', error.message);
        await aiVideoRef.update({
          status: 'failed',
          error: error.message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await createAlert(userId, 'enhancement_failure', `Video enhancement failed: ${error.message}`, { videoId });
      }
    });
  } catch (error) {
    console.error('Error initiating video processing:', error.message);
    res.status(500).json({ error: 'Failed to initiate video processing', message: error.message });
  }
});

// GET /status/job/:aiVideoId - Check the status of a specific video processing job
router.get('/status/job/:aiVideoId', verifyToken, async (req, res) => {
  const { aiVideoId } = req.params;
  const userId = req.user.uid;

  try {
    const aiVideoRef = db.collection('aiVideos').doc(aiVideoId);
    const aiVideoDoc = await aiVideoRef.get();

    if (!aiVideoDoc.exists) {
      console.log('AI video not found for aiVideoId:', aiVideoId);
      return res.status(404).json({ error: 'AI video not found' });
    }

    const aiVideoData = aiVideoDoc.data();
    if (aiVideoData.userId !== userId) {
      console.log('Forbidden: User does not own this AI video');
      return res.status(403).json({ error: 'Forbidden: You do not own this AI video' });
    }

    const status = aiVideoData.status;
    if (status === 'completed') {
      return res.status(200).json({
        status: 'completed',
        processedVideoUrl: aiVideoData.processedVideoUrl,
      });
    } else if (status === 'failed') {
      return res.status(200).json({
        status: 'failed',
        error: aiVideoData.error || 'Processing failed',
      });
    } else {
      return res.status(200).json({
        status: 'processing',
      });
    }
  } catch (error) {
    console.error('Error checking video processing status:', error);
    res.status(500).json({
      status: 'unknown',
      error: 'Failed to check processing status',
      message: error.message,
    });
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

// GET /ai-videos - Retrieve all processed videos for the user (most recent first)
router.get('/ai-videos', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  console.log('Fetching aiVideos for user:', userId);

  try {
    const snapshot = await db.collection('aiVideos')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
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
      .orderBy('createdAt', 'desc')
      .get();

    const aiVideos = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const videoData = doc.data();
        const filePath = videoData.processedVideoUrl?.replace(`gs://${storage.bucket().name}/`, '');
        const signedUrl = filePath ? await generateSignedUrl(filePath) : null;
        return {
          id: doc.id,
          ...videoData,
          processedVideoUrl: signedUrl || videoData.processedVideoUrl,
        };
      })
    );

    console.log(`Found ${aiVideos.length} aiVideos for campaignId: ${campaignId}`);
    res.status(200).json(aiVideos);
  } catch (error) {
    console.error('Error in get ai-videos/campaign endpoint:', error);
    res.status(500).json({ error: 'Failed to retrieve AI videos', message: error.message });
  }
});

// GET /status/:videoId - Check the status of a video processing job (legacy, kept for compatibility)
router.get('/status/:videoId', verifyToken, async (req, res) => {
  const { videoId } = req.params;
  const userId = req.user.uid;
  console.log('Checking processing status for videoId:', videoId);

  try {
    const aiVideoSnapshot = await db.collection('aiVideos')
      .where('originalVideoId', '==', videoId)
      .limit(1)
      .get();

    if (!aiVideoSnapshot.empty) {
      console.log('Video already processed and exists in aiVideos');
      return res.status(200).json({
        status: 'completed',
        aiVideoId: aiVideoSnapshot.docs[0].id,
        processedVideoUrl: aiVideoSnapshot.docs[0].data().processedVideoUrl,
      });
    }

    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();

    if (!videoDoc.exists) {
      console.log('Video not found for videoId:', videoId);
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;

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

    const failureAlertSnapshot = await db.collection('alerts')
      .where('userId', '==', userId)
      .where('alertType', '==', 'enhancement_failure')
      .where('extraData.videoId', '==', videoId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (!failureAlertSnapshot.empty) {
      console.log('Found failure alert for videoId:', videoId);
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

    console.log('Estimated progress for videoId:', videoId, progress);
    return res.status(200).json({
      status: 'processing',
      progress: progress,
      estimatedTimeRemaining: Math.max(0, estimatedTotalMs - elapsedMs),
    });
  } catch (error) {
    console.error('Error checking video processing status:', error);
    res.status(500).json({
      status: 'unknown',
      error: 'Failed to check processing status',
      message: error.message,
    });
  }
});

// DELETE /ai-videos/:aiVideoId - Delete an AI-generated video
router.delete('/ai-videos/:aiVideoId', verifyToken, async (req, res) => {
  const { aiVideoId } = req.params;
  const userId = req.user.uid;

  try {
    const aiVideoRef = db.collection('aiVideos').doc(aiVideoId);
    const aiVideoDoc = await aiVideoRef.get();

    if (!aiVideoDoc.exists) {
      console.log('AI video not found for aiVideoId:', aiVideoId);
      return res.status(404).json({ error: 'AI video not found' });
    }

    const aiVideoData = aiVideoDoc.data();
    const campaignId = aiVideoData.campaignId;

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

    await aiVideoRef.delete();
    console.log('Deleted AI video document with ID:', aiVideoId);

    const processedVideoUrl = aiVideoData.processedVideoUrl;
    if (processedVideoUrl) {
      const bucket = storage.bucket();
      const fileName = processedVideoUrl.replace(`gs://${bucket.name}/`, '');
      const file = bucket.file(fileName);
      try {
        await file.delete();
        console.log('Deleted video file from GCS:', fileName);
      } catch (deleteError) {
        console.error('Error deleting video file from GCS:', deleteError.message);
      }
    }

    res.status(200).json({ message: 'AI video deleted successfully' });
  } catch (error) {
    console.error('Error deleting AI video:', error.message);
    res.status(500).json({ error: 'Failed to delete AI video', message: error.message });
  }
});

module.exports = router;