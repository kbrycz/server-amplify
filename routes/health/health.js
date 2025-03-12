/**
 * Health Check Endpoint
 *
 * This endpoint provides a basic health check for the server.
 * When a GET request is made to /health, it returns a 200 OK status with a JSON response.
 *
 * @example
 *   GET /health
 *   Response: { status: "ok", timestamp: "2025-03-12T03:00:00.000Z" }
 */

const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  // Return a simple JSON response indicating the server is up
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;