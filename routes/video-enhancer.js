// video-enhancer.js
const express = require('express');
const multer = require('multer');
const admin = require('../firebase');
const { verifyToken } = require('../middleware');
const axios = require('axios');
const { logActivity } = require('../activityLogger'); // Import activity logger

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max; adjust if needed
});

const db = admin.firestore();
const storage = admin.storage();

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

// POST /videoEnhancer/upload
// Uploads a raw video and processes it with Shotstack in one request
router.post('/upload', verifyToken, upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Video file is required' });
  }

  const {
    desiredLength,
    transitionEffect,
    captionText,
    backgroundMusic,
    outputResolution
  } = req.body; // Accept Shotstack parameters from the request body

  try {
    const userId = req.user.uid;
    const videoData = {
      userId,
      title: req.body.title || 'Untitled Video',
      description: req.body.description || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Create a new document in "enhancerVideos"
    const docRef = await db.collection('enhancerVideos').add(videoData);
    const videoId = docRef.id;

    // Upload video to Cloud Storage
    const bucket = storage.bucket();
    const fileName = `enhancerVideos/${userId}/${videoId}.mp4`;
    const file = bucket.file(fileName);

    await new Promise((resolve, reject) => {
      const stream = file.createWriteStream({
        metadata: { contentType: req.file.mimetype },
      });
      stream.on('error', reject);
      stream.on('finish', resolve);
      stream.end(req.file.buffer);
    });

    const videoUrl = `gs://${bucket.name}/${fileName}`;
    await docRef.update({ videoUrl });

    // Log activity: video uploaded
    await logActivity(userId, 'video_enhancer_uploaded', `Uploaded video for enhancement: ${videoData.title}`, { videoId });

    // Generate signed URL for Shotstack
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      version: 'v4',
    });

    // Prepare Shotstack template (similar to /process-video)
    const clipLength = Math.min(Number(desiredLength) || 60, 300);
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
                asset: {
                  type: 'audio',
                  src: backgroundMusic || 'https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/freepd/motions.mp3',
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

    const SHOTSTACK_API_KEY = process.env.SHOTSTACK_API_KEY;
    if (!SHOTSTACK_API_KEY) {
      throw new Error('SHOTSTACK_API_KEY environment variable is not set');
    }

    // Initiate Shotstack render
    const shotstackResponse = await axios.post(
      'https://api.shotstack.io/edit/stage/render',
      shotstackTemplate,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': SHOTSTACK_API_KEY,
        },
      }
    );

    if (!shotstackResponse.data.success) {
      throw new Error(shotstackResponse.data.message || 'Shotstack API failed');
    }
    const renderId = shotstackResponse.data.response.id;

    // Poll for render completion
    let renderStatus;
    let processedVideoUrl;
    let attempts = 0;
    const maxAttempts = 60;
    do {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;
      const statusResponse = await axios.get(
        `https://api.shotstack.io/edit/stage/render/${renderId}`,
        { headers: { 'x-api-key': SHOTSTACK_API_KEY } }
      );
      renderStatus = statusResponse.data.response.status;
      if (renderStatus === 'done') {
        processedVideoUrl = statusResponse.data.response.url;
        break;
      }
      if (renderStatus === 'failed') {
        throw new Error(`Shotstack render failed: ${statusResponse.data.response.error || 'Unknown error'}`);
      }
      if (attempts >= maxAttempts) {
        throw new Error('Shotstack render timed out');
      }
    } while (renderStatus !== 'done');

    // Download and upload processed video
    const processedResponse = await axios.get(processedVideoUrl, { responseType: 'arraybuffer' });
    const processedBuffer = Buffer.from(processedResponse.data);
    const processedFileName = `enhancerVideos/processed/${userId}/${renderId}.mp4`;
    const processedFile = bucket.file(processedFileName);
    await processedFile.save(processedBuffer, { metadata: { contentType: 'video/mp4' } });
    const permanentUrl = `gs://${bucket.name}/${processedFileName}`;

    // Update Firestore with processed URL
    await docRef.update({ processedVideoUrl: permanentUrl });

    // Log activity and create alert
    await logActivity(userId, 'video_enhancer_processed', `Processed video: ${videoData.title}`, { videoId, renderId });
    await createAlert(userId, 'enhancement_success', 'Your video has been enhanced successfully.', {
      videoId,
      renderId,
      processedVideoUrl: permanentUrl,
    });

    res.status(201).json({
      message: 'Video uploaded and processed successfully',
      videoId,
      processedVideoUrl: permanentUrl,
    });
  } catch (error) {
    console.error('Error in upload endpoint:', error);
    await createAlert(userId, 'enhancement_failure', `Video enhancement failed: ${error.message}`, { videoId });
    res.status(500).json({ error: error.message });
  }
});

// DELETE /videoEnhancer/:videoId
// Deletes an enhancer video (Firestore document and associated storage files)
router.delete('/:videoId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const videoId = req.params.videoId;
    const docRef = db.collection('enhancerVideos').doc(videoId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = doc.data();
    if (videoData.userId !== userId) {
      return res.status(403).json({ error: 'You do not own this video' });
    }

    const bucket = storage.bucket();
    const gsPrefix = `gs://${bucket.name}/`;

    // Delete raw video file if exists
    if (videoData.videoUrl && videoData.videoUrl.startsWith(gsPrefix)) {
      const filePath = videoData.videoUrl.substring(gsPrefix.length);
      const file = bucket.file(filePath);
      try {
        await file.delete();
      } catch (err) {
        console.error('Error deleting raw video file:', err);
      }
    }

    // Delete processed video file if exists
    if (videoData.processedVideoUrl && videoData.processedVideoUrl.startsWith(gsPrefix)) {
      const filePath = videoData.processedVideoUrl.substring(gsPrefix.length);
      const file = bucket.file(filePath);
      try {
        await file.delete();
      } catch (err) {
        console.error('Error deleting processed video file:', err);
      }
    }

    // Delete Firestore document
    await docRef.delete();

    // Log activity: video deletion
    await logActivity(userId, 'video_enhancer_deleted', `Deleted video enhancement: ${videoData.title || 'Untitled Video'}`, { videoId });
    // Create an alert for deletion
    await createAlert(userId, 'enhancement_deleted', 'Your video enhancement has been deleted.', { videoId });

    res.status(200).json({ message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /videoEnhancer
// Lists all enhancer videos for the current user.
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db.collection('enhancerVideos')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();
    const videos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(videos);
  } catch (error) {
    console.error('Error fetching enhancer videos:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;