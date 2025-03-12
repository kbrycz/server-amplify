// activityLogger.js
const admin = require('../config/firebase');
const db = admin.firestore();

/**
 * Log an activity event.
 *
 * @param {string} userId - The user's ID.
 * @param {string} type - The type of activity (e.g. 'campaign_created', 'video_enhancer_processed').
 * @param {string} message - A human-readable message describing the activity.
 * @param {string} namespaceId - The namespace in which the activity occurred.
 * @param {object} extra - Any extra fields you want to store.
 */
async function logActivity(userId, type, message, namespaceId, extra = {}) {
  try {
    await db.collection('activity').add({
      userId,
      type,      // e.g. 'campaign_created', 'campaign_deleted', etc.
      message,
      namespaceId,
      ...extra,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

module.exports = { logActivity };