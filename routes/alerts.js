// alerts.js
const express = require('express');
const admin = require('../firebase'); // Your Firebase Admin instance
const { verifyToken } = require('../middleware'); // Your token verification middleware

const router = express.Router();
const db = admin.firestore();

// GET /alerts
// Retrieve all alerts for the authenticated user, ordered by createdAt descending
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snapshot = await db
      .collection('alerts')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const alerts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(alerts);
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts', message: error.message });
  }
});

// PATCH /alerts/mark-read
// Mark all alerts for the authenticated user as read
router.patch('/mark-read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const alertsQuery = db
      .collection('alerts')
      .where('userId', '==', userId)
      .where('read', '==', false);

    const snapshot = await alertsQuery.get();
    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, { read: true });
    });

    await batch.commit();
    res.status(200).json({ message: 'All alerts marked as read' });
  } catch (error) {
    console.error('Error marking alerts as read:', error);
    res.status(500).json({ error: 'Failed to mark alerts as read', message: error.message });
  }
});

module.exports = router;