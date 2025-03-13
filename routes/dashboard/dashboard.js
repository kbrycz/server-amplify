// dashboard.js
const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');

const router = express.Router();
const db = admin.firestore();

router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const namespaceId = req.query.namespaceId;
    
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    
    // Run all queries in parallel, filtering by user and namespaceId
    const [
      campaignsSnapshot,
      surveySnapshot,
      creatomateSnapshot,
      templatesSnapshot
    ] = await Promise.all([
      db.collection('campaigns')
        .where('createdBy', '==', userId)
        .get(),
      db.collection('surveyVideos')
        .where('userId', '==', userId)
        .where('namespaceId', '==', namespaceId)
        .get(),
      db.collection('creatomateJobs')
        .where('userId', '==', userId)
        .where('namespaceId', '==', namespaceId)
        .where('status', '==', 'succeeded')
        .get(),
      db.collection('templates')
        .where('createdBy', '==', userId)
        .get()
    ]);
    
    // Total campaigns count
    const campaignsCount = campaignsSnapshot.size;
    
    // Total survey responses (collected responses)
    const responsesCount = surveySnapshot.size;

    // Videos generated (using creatomate jobs with status "succeeded")
    const videosCount = creatomateSnapshot.size;

    // Total templates available
    const templatesCount = templatesSnapshot.size;
    
    return res.status(200).json({
      metrics: {
        campaigns: campaignsCount,  // Total campaigns created
        collected: responsesCount,  // Total survey responses
        videos: videosCount,        // AI videos generated (via creatomate)
        templates: templatesCount   // Total templates available
      }
    });
  } catch (error) {
    console.error('[ERROR] Error fetching dashboard metrics:', error);
    return res.status(500).json({
      error: 'Failed to fetch dashboard metrics',
      message: error.message
    });
  }
});

module.exports = router;