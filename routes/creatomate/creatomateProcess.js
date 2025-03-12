/**
 * Creatomate Process API
 *
 * This module processes a raw video using the Creatomate API with a basic template.
 * It takes a videoId from the client, looks up the raw video stored in Firebase Storage,
 * and sends it to Creatomate using a hard-coded template ID.
 *
 * Endpoints:
 *   POST /creatomate-process
 *     - Initiates processing of a raw video using the Creatomate API.
 *   GET  /creatomate/creatomate-process/status/job/:jobId
 *     - Checks the status of a specific Creatomate processing job.
 *   GET  /creatomate/ai-videos/campaign/:campaignId
 *     - Retrieves all completed (succeeded) Creatomate jobs for a given campaign.
 *
 * The API key is read from the environment variable CREATOMATE_API_KEY.
 */

const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const axios = require('axios');

const router = express.Router();
const db = admin.firestore();
const storage = admin.storage();

// Creatomate API configuration
const CREATOMATE_API_URL = 'https://api.creatomate.com/v1/renders';
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
// Hard-coded template ID – change this value as needed
const TEMPLATE_ID = '3fbdfb1d-958f-430c-b58c-4d4cf6588efd';

/**
 * Helper: Generate a signed URL for a Firebase Storage file.
 */
async function generateSignedUrl(filePath) {
  console.info(`[DEBUG] Generating signed URL for file: ${filePath}`);
  try {
    const file = storage.bucket().file(filePath);
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      version: 'v4',
    });
    console.info(`[DEBUG] Signed URL generated: ${signedUrl}`);
    return signedUrl;
  } catch (error) {
    console.error('[ERROR] Error generating signed URL:', error);
    throw new Error('Failed to generate signed URL for video');
  }
}

/**
 * Helper: Download a video from a URL and upload it to Google Cloud Storage.
 *
 * IMPORTANT: Instead of returning a "gs://" URL (which is not playable in browsers),
 * we now return a public HTTPS URL.
 */
async function downloadAndSaveVideo(videoUrl, campaignId, jobId) {
  try {
    console.info(`[DEBUG] Downloading processed video from Creatomate: ${videoUrl}`);
    const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    const videoBuffer = Buffer.from(response.data);
    const bucket = storage.bucket();
    const fileName = `creatomateVideos/processed/${campaignId}/${jobId}.mp4`;
    const file = bucket.file(fileName);
    await file.save(videoBuffer, {
      metadata: { contentType: 'video/mp4' },
    });
    // Construct an HTTPS URL for playback. This assumes your bucket files are accessible via storage.googleapis.com.
    const permanentUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    console.info(`[DEBUG] Processed video saved to GCS: ${permanentUrl}`);
    return permanentUrl;
  } catch (error) {
    console.error('[ERROR] Error downloading and saving video:', error);
    throw new Error('Failed to download and save video');
  }
}

/**
 * POST /creatomate-process
 *
 * Processes a video using Creatomate.
 */
router.post('/creatomate-process', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const { videoId } = req.body;
  if (!videoId) {
    console.warn('[WARN] videoId is required');
    return res.status(400).json({ error: 'videoId is required' });
  }
  try {
    // Check user credits
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.warn(`[WARN] User not found for userId: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = userDoc.data();
    if (typeof userData.credits !== 'number' || userData.credits < 1) {
      console.warn(`[WARN] Insufficient credits for userId: ${userId}`);
      return res.status(403).json({ error: 'Insufficient credits' });
    }
    // Fetch raw video from "surveyVideos" collection
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.warn(`[WARN] Video not found for videoId: ${videoId}`);
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;
    // Verify campaign ownership
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (campaignData.userId !== userId) {
      console.warn(`[WARN] User ${userId} not authorized for campaign ${campaignId}`);
      return res.status(403).json({ error: 'Forbidden: You do not own this campaign' });
    }
    
    // Update the survey video document to mark it as enhanced.
    // This sets isVideoEnhanced to true and videoEnhancedUrl to the same value as videoUrl.
    await videoRef.update({
      isVideoEnhanced: true,
      videoEnhancedUrl: videoData.videoUrl, // For now, set to the original videoUrl
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.info(`[INFO] Survey video ${videoId} marked as enhanced.`);
    // Respond immediately as we no longer process Creatomate jobs.
    return res.status(200).json({ message: 'Video enhanced successfully', videoId });
    
    /* ----- BEGIN: Comment out Creatomate API call for testing ----- */
    /*
    // Generate signed URL for the raw video
    const videoGsUrl = videoData.videoUrl;
    const gsPrefix = 'gs://amplify-dev-6b1c7.firebasestorage.app/';
    if (!videoGsUrl.startsWith(gsPrefix)) {
      console.error('[ERROR] Invalid video URL format:', videoGsUrl);
      return res.status(500).json({ error: 'Invalid video URL format' });
    }
    const filePath = videoGsUrl.substring(gsPrefix.length);
    const signedUrl = await generateSignedUrl(filePath);
    // Build Creatomate API request payload
    const requestData = {
      template_id: TEMPLATE_ID,
      modifications: {
        "Video-DHM.source": signedUrl
      }
    };
    // Call Creatomate API
    const creatomateResponse = await axios.post(
      CREATOMATE_API_URL,
      requestData,
      {
        headers: {
          'Authorization': `Bearer ${CREATOMATE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    let responseData = creatomateResponse.data;
    console.info('[DEBUG] Creatomate API raw response:', responseData);
    // Normalize response: if array, pick first element
    const renderResult = Array.isArray(responseData) ? responseData[0] : responseData;
    console.info('[DEBUG] Normalized render result:', renderResult);
    const updatePayload = {
      status: renderResult.status || 'queued',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (renderResult.id !== undefined) {
      updatePayload.creatomateJobId = renderResult.id;
    }
    if (renderResult.status === 'succeeded' && renderResult.url !== undefined) {
      const permanentUrl = await downloadAndSaveVideo(renderResult.url, campaignId, localJobId);
      updatePayload.processedVideoUrl = permanentUrl;
      updatePayload.snapshotUrl = renderResult.snapshot_url;
    }
    await jobRef.update(updatePayload);
    res.status(202).json({ message: 'Processing started', jobId: localJobId });
    // Background polling for job status
    setImmediate(async () => {
      let pollAttempts = 0;
      const maxAttempts = 60;
      let jobStatus = renderResult.status || 'queued';
      const pollingInterval = setInterval(async () => {
        pollAttempts++;
        try {
          const statusResponse = await axios.get(`${CREATOMATE_API_URL}/${renderResult.id}`, {
            headers: {
              'Authorization': `Bearer ${CREATOMATE_API_KEY}`,
              'Cache-Control': 'no-cache'
            }
          });
          const updatedStatus = statusResponse.data;
          console.info(`[DEBUG] Polling attempt ${pollAttempts}:`, updatedStatus);
          jobStatus = updatedStatus.status;
          const pollUpdate = {
            status: jobStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };
          if (jobStatus === 'succeeded' && updatedStatus.url !== undefined) {
            const permanentUrl = await downloadAndSaveVideo(updatedStatus.url, campaignId, localJobId);
            pollUpdate.processedVideoUrl = permanentUrl;
            pollUpdate.snapshotUrl = updatedStatus.snapshot_url;
          }
          await jobRef.update(pollUpdate);
          if (jobStatus === 'succeeded' || jobStatus === 'failed') {
            console.info('[DEBUG] Job finished with status:', jobStatus);
            clearInterval(pollingInterval);
          }
        } catch (err) {
          console.error('[ERROR] Error polling Creatomate status:', err.message);
          if (err.response && err.response.status === 400) {
            await jobRef.update({
              status: 'failed',
              error: err.response.data.error || '400 error during status polling',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            clearInterval(pollingInterval);
          } else if (pollAttempts >= maxAttempts) {
            await jobRef.update({
              status: 'timeout',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            clearInterval(pollingInterval);
          }
        }
      }, 5000);
    });
    */
    /* ----- END: Comment out Creatomate API call for testing ----- */
  } catch (error) {
    console.error('[ERROR] Error initiating Creatomate processing:', error.message);
    return res.status(500).json({ error: 'Failed to initiate video processing', message: error.message });
  }
});

/**
 * GET /creatomate-process/status/job/:jobId
 *
 * Checks the status of a specific Creatomate processing job.
 */
router.get('/creatomate-process/status/job/:jobId', verifyToken, async (req, res) => {
  const localJobId = req.params.jobId;
  const userId = req.user.uid;
  try {
    const jobRef = db.collection('creatomateJobs').doc(localJobId);
    const jobDoc = await jobRef.get();
    if (!jobDoc.exists) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const jobData = jobDoc.data();
    if (jobData.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this job' });
    }
    // For testing, simply return the job document.
    return res.status(200).json({ id: localJobId, ...jobData });
  } catch (error) {
    console.error('[ERROR] Error checking job status:', error.message);
    return res.status(500).json({ error: 'Failed to check job status', message: error.message });
  }
});

/**
 * GET /creatomate/ai-videos/campaign/:campaignId
 *
 * Retrieves all completed (succeeded) Creatomate jobs for a given campaign.
 */
router.get('/ai-videos/campaign/:campaignId', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const campaignId = req.params.campaignId;
  try {
    const snapshot = await db.collection('creatomateJobs')
      .where('campaignId', '==', campaignId)
      .where('userId', '==', userId)
      .where('status', '==', 'succeeded')
      .orderBy('createdAt', 'desc')
      .get();
    const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(jobs);
  } catch (error) {
    console.error('[ERROR] Error fetching AI videos for campaign:', error.message);
    return res.status(500).json({ error: 'Failed to fetch AI videos for campaign', message: error.message });
  }
});

module.exports = router;