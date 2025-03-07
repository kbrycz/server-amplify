// recentActivity.js
const express = require('express');
const admin = require('../../config/firebase');
const { verifyToken } = require('../../config/middleware');
const router = express.Router();

const db = admin.firestore();

// GET /activity
// Fetch recent activity for the authenticated user, sorted by createdAt descending, limited to 50.
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db.collection('activity')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get();
    const activities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(activities);
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ error: 'Failed to fetch activity', message: error.message });
  }
});

module.exports = router;