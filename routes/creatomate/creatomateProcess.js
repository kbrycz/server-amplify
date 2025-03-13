/**
 * Creatomate Process API
 *
 * This module processes a raw video using the Creatomate API with a basic template.
 * It takes a videoId from the client, looks up the raw video stored in Firebase Storage,
 * and sends it to Creatomate using a hard-coded template ID.
 *
 * Endpoints:
 *   POST /creatomate-process
 *     - Initiates processing (enhancing) of a raw video using the Creatomate API (commented out).
 *       Currently, it just marks the video as "enhanced" without actually calling Creatomate.
 *   GET  /creatomate-process/status/job/:jobId
 *     - Checks the status of a specific Creatomate processing job (with membership check).
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
 * Helper: getUserPermission(namespaceId, userEmail)
 * Checks if the user is an active member in that namespace,
 * returns 'admin', 'read/write', 'readonly', or null if not found.
 */
async function getUserPermission(namespaceId, userEmail) {
  if (!namespaceId || !userEmail) return null;
  const nsDoc = await db.collection('namespaces').doc(namespaceId).get();
  if (!nsDoc.exists) return null;

  const nsData = nsDoc.data();
  if (!nsData.members) return null;

  // case-insensitive match
  const member = nsData.members.find(m =>
    m.email.toLowerCase() === userEmail.toLowerCase() && m.status === 'active'
  );
  return member ? member.permission : null;
}

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
 * For the commented-out Creatomate approach.
 */
async function downloadAndSaveVideo(videoUrl, campaignId, jobId) {
  try {
    console.info(`[DEBUG] Downloading processed video from Creatomate: ${videoUrl}`);
    const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
    const videoBuffer = Buffer.from(response.data);
    const bucket = admin.storage().bucket();
    const fileName = `creatomateVideos/processed/${campaignId}/${jobId}.mp4`;
    const file = bucket.file(fileName);
    await file.save(videoBuffer, {
      metadata: { contentType: 'video/mp4' },
    });
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
 * Enhances a video. Currently, it just sets isVideoEnhanced = true on the doc,
 * but does not actually call Creatomate (commented out).
 */
router.post('/creatomate-process', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const userEmail = req.user.email;
  const { videoId } = req.body;

  if (!videoId) {
    console.warn('[WARN] videoId is required');
    return res.status(400).json({ error: 'videoId is required' });
  }
  try {
    // Check user doc for credits
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

    // Fetch raw video from "surveyVideos"
    const videoRef = db.collection('surveyVideos').doc(videoId);
    const videoDoc = await videoRef.get();
    if (!videoDoc.exists) {
      console.warn(`[WARN] Video not found for videoId: ${videoId}`);
      return res.status(404).json({ error: 'Video not found' });
    }
    const videoData = videoDoc.data();
    const campaignId = videoData.campaignId;

    // Fetch the campaign to see if user has "read/write" or "admin" permission
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      console.warn(`[WARN] Campaign not found for campaignId: ${campaignId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (!campaignData.namespaceId) {
      console.error('[ERROR] Campaign missing namespaceId; cannot check permissions');
      return res.status(500).json({ error: 'Campaign missing namespaceId' });
    }
    const permission = await getUserPermission(campaignData.namespaceId, userEmail);
    if (!permission || (permission !== 'read/write' && permission !== 'admin')) {
      console.warn(`[WARN] User ${userId} does not have write permission in namespace ${campaignData.namespaceId}`);
      return res.status(403).json({ error: 'Insufficient permissions to enhance this video' });
    }

    // Mark the video as "enhanced" in surveyVideos
    await videoRef.update({
      isVideoEnhanced: true,
      videoEnhancedUrl: videoData.videoUrl, // For now, set it to original
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.info(`[INFO] Survey video ${videoId} marked as enhanced.`);

    return res.status(200).json({ message: 'Video enhanced successfully', videoId });

    /* 
    // The actual Creatomate code is commented out. If you want to re-enable it,
    // also update the code to do a membership check, fetch a job doc, etc.
    */
  } catch (error) {
    console.error('[ERROR] Error initiating Creatomate processing:', error.message);
    return res.status(500).json({ error: 'Failed to initiate video processing', message: error.message });
  }
});

/**
 * GET /creatomate-process/status/job/:jobId
 *
 * Checks the status of a specific Creatomate processing job.
 * We fetch the job doc, then confirm the user is part of that campaign's namespace (if stored).
 */
router.get('/creatomate-process/status/job/:jobId', verifyToken, async (req, res) => {
  const localJobId = req.params.jobId;
  const userEmail = req.user.email;

  try {
    const jobRef = db.collection('creatomateJobs').doc(localJobId);
    const jobDoc = await jobRef.get();
    if (!jobDoc.exists) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const jobData = jobDoc.data();

    // We assume the job doc references a campaignId. 
    // If it doesn't, adjust logic accordingly.
    const campaignRef = db.collection('campaigns').doc(jobData.campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      return res.status(404).json({ error: 'Campaign not found for this job' });
    }
    const campaignData = campaignDoc.data();
    if (!campaignData.namespaceId) {
      return res.status(500).json({ error: 'Campaign missing namespaceId' });
    }
    // Check membership in that namespace (any membership allows read?). 
    // If you want only the job creator or admin to see status, adjust here.
    const permission = await getUserPermission(campaignData.namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Forbidden: no permission in campaign namespace' });
    }

    // For testing, just return the job doc
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
 * Also checks the user's membership in campaign.namespaceId.
 */
router.get('/ai-videos/campaign/:campaignId', verifyToken, async (req, res) => {
  const campaignId = req.params.campaignId;
  const userEmail = req.user.email;

  try {
    // Confirm user belongs to that campaign's namespace
    const campaignRef = db.collection('campaigns').doc(campaignId);
    const campaignDoc = await campaignRef.get();
    if (!campaignDoc.exists) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const campaignData = campaignDoc.data();
    if (!campaignData.namespaceId) {
      return res.status(500).json({ error: 'Campaign missing namespaceId' });
    }

    const permission = await getUserPermission(campaignData.namespaceId, userEmail);
    if (!permission) {
      return res.status(403).json({ error: 'Forbidden: no permission for this campaign namespace' });
    }

    // Now fetch creatomateJobs where status == 'succeeded' and campaignId matches
    const snapshot = await db.collection('creatomateJobs')
      .where('campaignId', '==', campaignId)
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