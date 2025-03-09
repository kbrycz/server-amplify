/**
 * Representatives API
 *
 * This module provides an endpoint to fetch and categorize government officials
 * (federal, state, and local) based on a provided 5-digit zip code using the
 * Google Civic Information API.
 *
 * Endpoint:
 *   GET /:zipcode
 *     - Validates the provided zip code.
 *     - Calls the Google Civic API to retrieve representative data.
 *     - Categorizes the officials into federal, state, and local groups.
 *
 * @example
 *   curl https://yourdomain.com/representatives/90210
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();
require('dotenv').config();

// Load Google Civic Information API key from environment variables
const GOOGLE_CIVIC_API_KEY = process.env.GOOGLE_CIVIC_API_KEY;
if (!GOOGLE_CIVIC_API_KEY) {
  throw new Error('GOOGLE_CIVIC_API_KEY environment variable is not set');
}

/**
 * Extract official details from an official object.
 *
 * @param {Object} official - Official data from the API.
 * @returns {Object} A simplified official object with name, party, phones, emails, urls, and photoUrl.
 */
function extractOfficial(official) {
  return {
    name: official.name,
    party: official.party || 'Unknown',
    phones: official.phones || [],
    emails: official.emails || [],
    urls: official.urls || [],
    photoUrl: official.photoUrl || null
  };
}

/**
 * Categorize officials from the API response into federal, state, and local groups.
 *
 * @param {Object} data - The raw data from the Google Civic Information API.
 * @returns {Object} An object with categorized officials.
 */
function categorizeOfficials(data) {
  const categorized = {
    federal: {
      senators: [],
      representatives: []
    },
    state: {
      senators: [],
      representatives: []
    },
    local: []
  };

  data.offices.forEach(office => {
    const level = office.levels ? office.levels[0] : null;
    const role = office.roles ? office.roles[0] : null;
    const officials = office.officialIndices.map(index => extractOfficial(data.officials[index]));

    if (level === 'country') {
      if (role === 'legislatorUpperBody') {
        categorized.federal.senators.push(...officials); // U.S. Senators
      } else if (role === 'legislatorLowerBody') {
        categorized.federal.representatives.push(...officials); // U.S. House Representatives
      }
    } else if (level === 'administrativeArea1') {
      if (role === 'legislatorUpperBody') {
        categorized.state.senators.push(...officials); // State Senators
      } else if (role === 'legislatorLowerBody') {
        categorized.state.representatives.push(...officials); // State Representatives
      }
    } else if (level === 'locality' || level === 'administrativeArea2') {
      officials.forEach(official => {
        categorized.local.push({ ...official, office: office.name }); // Local officials with office title
      });
    }
  });

  return categorized;
}

/**
 * GET /:zipcode
 * Fetch and categorize representatives based on the provided 5-digit zip code.
 *
 * Validates the zip code and makes a GET request to the Google Civic Information API.
 * Returns a categorized list of officials (federal, state, and local).
 *
 * @example
 *   curl https://yourdomain.com/representatives/90210
 */
router.get('/:zipcode', async (req, res) => {
  const zipcode = req.params.zipcode;

  // Validate zip code (must be 5 digits)
  if (!/^\d{5}$/.test(zipcode)) {
    console.warn(`[WARN] Invalid zip code received: ${zipcode}`);
    return res.status(400).json({ error: 'Invalid zip code. Must be a 5-digit number.' });
  }

  try {
    const url = `https://civicinfo.googleapis.com/civicinfo/v2/representatives?address=${zipcode}&key=${GOOGLE_CIVIC_API_KEY}`;
    console.info(`[INFO] Requesting representatives for zip code: ${zipcode}`);
    const response = await axios.get(url);
    const data = response.data;
    const categorized = categorizeOfficials(data);
    console.info(`[INFO] Successfully retrieved representatives for zip code: ${zipcode}`);
    return res.status(200).json(categorized);
  } catch (error) {
    if (error.response) {
      console.error('[ERROR] Google Civic API error:', error.response.data);
      return res.status(error.response.status).json({ error: error.response.data.error.message });
    } else if (error.request) {
      console.error('[ERROR] No response from Google Civic API');
      return res.status(500).json({ error: 'No response from Google Civic API' });
    } else {
      console.error('[ERROR] Error setting up request:', error.message);
      return res.status(500).json({ error: 'Failed to fetch representatives' });
    }
  }
});

module.exports = router;