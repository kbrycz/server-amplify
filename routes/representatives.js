const express = require('express');
const axios = require('axios');
const router = express.Router();
require('dotenv').config();

// Load Google Civic Information API key from environment variables
const GOOGLE_CIVIC_API_KEY = process.env.GOOGLE_CIVIC_API_KEY;
if (!GOOGLE_CIVIC_API_KEY) {
  throw new Error('GOOGLE_CIVIC_API_KEY environment variable is not set');
}

// Helper function to extract official details
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

// Helper function to categorize officials from API response
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

// GET endpoint to fetch representatives by zip code
router.get('/:zipcode', async (req, res) => {
  const zipcode = req.params.zipcode;

  // Validate zip code (must be 5 digits)
  if (!/^\d{5}$/.test(zipcode)) {
    return res.status(400).json({ error: 'Invalid zip code. Must be a 5-digit number.' });
  }

  try {
    const url = `https://civicinfo.googleapis.com/civicinfo/v2/representatives?address=${zipcode}&key=${GOOGLE_CIVIC_API_KEY}`;
    const response = await axios.get(url);
    const data = response.data;

    const categorized = categorizeOfficials(data);
    res.status(200).json(categorized);
  } catch (error) {
    if (error.response) {
      // API returned an error response
      console.error('Google Civic API error:', error.response.data);
      res.status(error.response.status).json({ error: error.response.data.error.message });
    } else if (error.request) {
      // No response received from API
      console.error('No response from Google Civic API');
      res.status(500).json({ error: 'No response from Google Civic API' });
    } else {
      // Error setting up the request
      console.error('Error setting up request:', error.message);
      res.status(500).json({ error: 'Failed to fetch representatives' });
    }
  }
});

module.exports = router;