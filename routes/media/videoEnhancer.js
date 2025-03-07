const express = require('express');
const multer = require('multer');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const axios = require('axios');
const { logActivity } = require('../../utils/activityLogger');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max; adjust as needed
});

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

// **POST /videoEnhancer/upload**
// Uploads a raw video and initiates processing with Shotstack
router.post('/upload', verifyToken, upload.single('video'), async (req, res) => {
  if (!req.file) {
    console.log('Validation Failed: Video file is required');
    return res.status(400).json({ error: 'Video file is required' });
  }

  const userId = req.user.uid;
  const { desiredLength, transitionEffect, captionText, backgroundMusic, outputResolution } = req.body;

  let videoId;
  try {
    // Check user's credits
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.log('User not found for userId:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();
    const credits = userData.credits || 0;
    if (credits < 1) {
      console.log('Insufficient credits for userId:', userId);
      return res.status(403).json({ error: 'Insufficient credits' });
    }

    // Create a new document in "enhancerVideos"
    const videoData = {
      userId,
      title: req.body.title || 'Untitled Video',
      description: req.body.description || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
      renderId: null,
      processedVideoUrl: null,
    };
    const docRef = await db.collection('enhancerVideos').add(videoData);
    videoId = docRef.id;
    console.log('Created enhancerVideos document with ID:', videoId);

    // Upload raw video to Cloud Storage
    const bucket = storage.bucket();
    const rawFileName = `enhancerVideos/${userId}/${videoId}.mp4`;
    const rawFile = bucket.file(rawFileName);
    await new Promise((resolve, reject) => {
      const stream = rawFile.createWriteStream({
        metadata: { contentType: req.file.mimetype },
      });
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(req.file.buffer);
    });
    const videoUrl = `gs://${bucket.name}/${rawFileName}`;
    await docRef.update({ videoUrl });
    console.log('Raw video uploaded to GCS:', videoUrl);

    // Log activity
    await logActivity(userId, 'video_enhancer_uploaded', `Uploaded video for enhancement: ${videoData.title}`, { videoId });

    // Generate signed URL for Shotstack
    const signedUrl = await generateSignedUrl(rawFileName);

    // Check video duration
    const videoDuration = await getVideoDuration(signedUrl);
    console.log('Video duration (seconds):', videoDuration);

    // Define clip length
    const clipLength = Math.min(videoDuration, Number(desiredLength) || 60);
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
                  text: captionText || 'Enhanced Video',
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

    if (!SHOTSTACK_API_KEY) {
      throw new Error('SHOTSTACK_API_KEY environment variable is not set');
    }

    // Initiate Shotstack render
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

    // Update document with renderId
    await docRef.update({
      renderId,
      status: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Respond immediately
    res.status(202).json({
      message: 'Video upload successful, processing initiated',
      videoId,
      renderId,
    });

    // Background processing
    (async () => {
      try {
        let renderStatus;
        let processedVideoUrl;
        let pollAttempts = 0;
        const maxAttempts = 60;

        do {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          pollAttempts++;
          console.log(`Polling Shotstack render status, attempt ${pollAttempts}/${maxAttempts}`);
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

        console.log('Processed video URL from Shotstack:', processedVideoUrl);

        // Download and upload video
        const videoResponse = await axios.get(processedVideoUrl, { responseType: 'arraybuffer' });
        const videoBuffer = Buffer.from(videoResponse.data);

        const processedFileName = `enhancerVideos/processed/${userId}/${renderId}.mp4`;
        const processedFile = bucket.file(processedFileName);
        await processedFile.save(videoBuffer, {
          metadata: { contentType: 'video/mp4' },
        });

        const permanentUrl = `gs://${bucket.name}/${processedFileName}`;
        console.log('Processed video uploaded to GCS:', permanentUrl);

        // Update document
        await docRef.update({
          processedVideoUrl: permanentUrl,
          status: 'completed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Deduct credit
        await userRef.update({
          credits: admin.firestore.FieldValue.increment(-1),
        });

        // Log and alert
        await logActivity(userId, 'video_enhancer_processed', `Processed video: ${videoData.title}`, { videoId, renderId });
        await createAlert(userId, 'enhancement_success', 'Your video has been enhanced successfully.', {
          videoId,
          renderId,
          processedVideoUrl: permanentUrl,
        });
      } catch (error) {
        console.error('Background processing error:', error.message);
        await docRef.update({
          status: 'failed',
          error: error.message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await createAlert(userId, 'enhancement_failure', `Video enhancement failed: ${error.message}`, { videoId, renderId });
      }
    })();
  } catch (error) {
    console.error('Error in upload endpoint:', error.message);
    if (videoId) {
      await db.collection('enhancerVideos').doc(videoId).update({
        status: 'failed',
        error: error.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await createAlert(userId, 'enhancement_failure', `Video enhancement failed: ${error.message}`, videoId ? { videoId } : {});
    res.status(500).json({ error: 'Failed to initiate video processing', message: error.message });
  }
});

// **DELETE /videoEnhancer/:videoId**
// Deletes a video and its associated files
router.delete('/:videoId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const videoId = req.params.videoId;
    const docRef = db.collection('enhancerVideos').doc(videoId);
    const doc = await docRef.get();
    if (!doc.exists) {
      console.log('Video not found for videoId:', videoId);
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = doc.data();
    if (videoData.userId !== userId) {
      console.log('Forbidden: User does not own this video');
      return res.status(403).json({ error: 'You do not own this video' });
    }

    const bucket = storage.bucket();
    const gsPrefix = `gs://${bucket.name}/`;

    // Delete raw video
    if (videoData.videoUrl && videoData.videoUrl.startsWith(gsPrefix)) {
      const filePath = videoData.videoUrl.substring(gsPrefix.length);
      const file = bucket.file(filePath);
      try {
        await file.delete();
        console.log('Deleted raw video file:', filePath);
      } catch (err) {
        console.error('Error deleting raw video file:', err.message);
      }
    }

    // Delete processed video
    if (videoData.processedVideoUrl && videoData.processedVideoUrl.startsWith(gsPrefix)) {
      const filePath = videoData.processedVideoUrl.substring(gsPrefix.length);
      const file = bucket.file(filePath);
      try {
        await file.delete();
        console.log('Deleted processed video file:', filePath);
      } catch (err) {
        console.error('Error deleting processed video file:', err.message);
      }
    }

    // Delete Firestore document
    await docRef.delete();
    console.log('Deleted enhancerVideos document:', videoId);

    await logActivity(userId, 'video_enhancer_deleted', `Deleted video enhancement: ${videoData.title || 'Untitled Video'}`, { videoId });
    await createAlert(userId, 'enhancement_deleted', 'Your video enhancement has been deleted.', { videoId });

    res.status(200).json({ message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Error deleting video:', error.message);
    res.status(500).json({ error: 'Failed to delete video', message: error.message });
  }
});

// **GET /videoEnhancer**
// Retrieve all enhanced videos for the user
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log('Fetching enhancerVideos for user:', userId);
    const snapshot = await db.collection('enhancerVideos')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    const videos = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    console.log(`Found ${videos.length} enhancerVideos`);
    res.status(200).json(videos);
  } catch (error) {
    console.error('Error fetching enhancer videos:', error.message);
    res.status(500).json({ error: 'Failed to retrieve enhancer videos', message: error.message });
  }
});

// **GET /videoEnhancer/status/:videoId**
// Check the status of a video enhancement job
router.get('/status/:videoId', verifyToken, async (req, res) => {
  const { videoId } = req.params;
  const userId = req.user.uid;
  console.log('Checking enhancement status for videoId:', videoId);

  try {
    const videoRef = db.collection('enhancerVideos').doc(videoId);
    const videoDoc = await videoRef.get();

    if (!videoDoc.exists) {
      console.log('Video not found for videoId:', videoId);
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoData = videoDoc.data();
    if (videoData.userId !== userId) {
      console.log('Forbidden: User does not own this video');
      return res.status(403).json({ error: 'You do not own this video' });
    }

    const status = videoData.status || 'pending';

    if (status === 'completed') {
      console.log('Video already processed for videoId:', videoId);
      const filePath = videoData.processedVideoUrl?.replace(`gs://${storage.bucket().name}/`, '');
      const signedUrl = filePath ? await generateSignedUrl(filePath) : null;
      return res.status(200).json({
        status: 'completed',
        videoId,
        processedVideoUrl: signedUrl || videoData.processedVideoUrl,
      });
    }

    if (status === 'failed') {
      console.log('Video processing failed for videoId:', videoId);
      const failureAlertSnapshot = await db.collection('alerts')
        .where('userId', '==', userId)
        .where('alertType', '==', 'enhancement_failure')
        .where('extraData.videoId', '==', videoId)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      const errorMessage = failureAlertSnapshot.empty
        ? videoData.error || 'Processing failed'
        : failureAlertSnapshot.docs[0].data().message || 'Processing failed';
      return res.status(200).json({
        status: 'failed',
        error: errorMessage,
      });
    }

    if (status === 'processing') {
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
    }

    console.log('Video is in pending state for videoId:', videoId);
    return res.status(200).json({ status: 'pending' });
  } catch (error) {
    console.error('Error checking video enhancement status:', error.message);
    res.status(500).json({
      status: 'unknown',
      error: 'Failed to check enhancement status',
      message: error.message,
    });
  }
});

module.exports = router;