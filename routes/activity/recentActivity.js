/**
 * Recent Activity API
 *
 * This module provides an endpoint to fetch recent activity records for an authenticated user.
 *
 * Endpoint:
 *   GET /activity
 *     - Retrieves the most recent 25 activity entries for the user, sorted by creation time (descending).
 *
 * @example
 *   curl -H "Authorization: Bearer YOUR_TOKEN" https://yourdomain.com/activity
 */

const express = require('express');
const admin = require('../../config/firebase'); // Firebase Admin instance
const { verifyToken } = require('../../config/middleware'); // Token verification middleware

const router = express.Router();
const db = admin.firestore();

/**
 * GET /activity
 * Retrieves recent activity (up to 25 items) for the authenticated user.
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log(`[INFO] Fetching recent activity for user: ${userId}`);

    const snapshot = await db.collection('activity')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get();
    const activities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`[INFO] Retrieved ${activities.length} activity items for user: ${userId}`);
    return res.status(200).json(activities);
  } catch (error) {
    console.error('[ERROR] Failed to fetch recent activity:', error);
    return res.status(500).json({ error: 'Failed to fetch activity', message: error.message });
  }
});

module.exports = router;