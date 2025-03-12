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
      alertsSnapshot,
      creatomateSnapshot,
      templatesSnapshot,
      userDoc
    ] = await Promise.all([
      db.collection('campaigns')
        .where('userId', '==', userId)
        .where('namespaceId', '==', namespaceId)
        .get(),
      db.collection('surveyVideos')
        .where('userId', '==', userId)
        .where('namespaceId', '==', namespaceId)
        .get(),
      db.collection('alerts')
        .where('userId', '==', userId)
        .where('namespaceId', '==', namespaceId)
        .where('read', '==', false)
        .get(),
      db.collection('creatomateJobs')
        .where('userId', '==', userId)
        .where('namespaceId', '==', namespaceId)
        .where('status', '==', 'succeeded')
        .get(),
      db.collection('templates')
        .where('userId', '==', userId)
        .where('namespaceId', '==', namespaceId)
        .get(),
      db.collection('users').doc(userId).get()
    ]);
    
    // Total campaigns count
    const campaignsCount = campaignsSnapshot.size;
    
    // Total survey responses (collected responses)
    const responsesCount = surveySnapshot.size;
    
    // Calculate total reach as the count of unique email addresses in survey responses
    const uniqueEmails = new Set();
    surveySnapshot.forEach(doc => {
      const data = doc.data();
      if (data.email) {
        uniqueEmails.add(data.email);
      }
    });
    const reachCount = uniqueEmails.size;
    
    // Unread responses (from alerts)
    const unreadCount = alertsSnapshot.size;
    
    // Videos generated (using creatomate jobs with status "succeeded")
    const videosCount = creatomateSnapshot.size;
    
    // Total templates available
    const templatesCount = templatesSnapshot.size;
    
    // Get user profile data
    const userData = userDoc.exists ? userDoc.data() : null;
    
    return res.status(200).json({
      metrics: {
        unread: unreadCount,         // Unread responses
        collected: responsesCount,     // Total survey responses
        campaigns: campaignsCount,     // Total campaigns created
        users: reachCount,             // Total unique users (reach)
        videos: videosCount,           // AI videos generated (via creatomate)
        templates: templatesCount      // Total templates available
      },
      user: userData
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