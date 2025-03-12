/**
 * Recent Activity API
 *
 * This module provides an endpoint to fetch recent activity records for an authenticated user,
 * filtered by a given namespace.
 *
 * Endpoint:
 *   GET /activity?namespaceId=<NAMESPACE_ID>
 *     - Retrieves the most recent 25 activity entries for the user in the specified namespace,
 *       sorted by creation time (descending).
 *
 * @example
 *   curl -H "Authorization: Bearer YOUR_TOKEN" "https://yourdomain.com/activity?namespaceId=DEFAULT_NAMESPACE_ID"
 */

const express = require('express');
const admin = require('../../config/firebase'); // Firebase Admin instance
const { verifyToken } = require('../../config/middleware'); // Token verification middleware

const router = express.Router();
const db = admin.firestore();

/**
 * GET /activity
 * Retrieves recent activity (up to 25 items) for the authenticated user filtered by namespace.
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const namespaceId = req.query.namespaceId;
    
    if (!namespaceId) {
      return res.status(400).json({ error: 'namespaceId query parameter is required' });
    }
    
    console.log(`[INFO] Fetching recent activity for user: ${userId} in namespace: ${namespaceId}`);

    const snapshot = await db.collection('activity')
      .where('userId', '==', userId)
      .where('namespaceId', '==', namespaceId)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get();
    
    const activities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`[INFO] Retrieved ${activities.length} activity items for user: ${userId} in namespace: ${namespaceId}`);
    return res.status(200).json(activities);
  } catch (error) {
    console.error('[ERROR] Failed to fetch recent activity:', error);
    return res.status(500).json({ error: 'Failed to fetch activity', message: error.message });
  }
});

module.exports = router;