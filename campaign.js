const express = require('express');
const axios = require('axios');
const router = express.Router();

// Replace with your actual Gemini API key (use environment variables in production)
const GEMINI_API_KEY = "AIzaSyDL9YD5eQIFeubDBczM76tpCK76bjjYjG0"
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

// Preprompt to guide Gemini API to always return structured JSON
const PREPROMPT = `
You are a helpful assistant tasked with generating a JSON object for a "Create Campaign" form based on a user's prompt. The JSON must include the following fields:

{
  "name": "string",
  "description": "string",
  "category": "string",
  "businessName": "string",
  "website": "string",
  "email": "string",
  "phone": "string",
  "surveyQuestions": ["string", "string", ...]
}

Always return a complete JSON object, even if the prompt is incomplete or unclear. For fields you can’t determine, use placeholder values like "Unknown", "TBD", or "" (empty string). For surveyQuestions, provide at least two generic questions if none are specified.

Example:
Prompt: "Create a campaign for a pet adoption event"
Response:
{
  "name": "Pet Adoption Event",
  "description": "A campaign to promote pet adoptions in the local community.",
  "category": "Animal Welfare",
  "businessName": "Local Pet Shelter",
  "website": "https://petshelter.org",
  "email": "info@petshelter.org",
  "phone": "(555) 987-6543",
  "surveyQuestions": [
    "What type of pet are you interested in?",
    "How did you hear about our event?"
  ]
}

Example with unclear prompt:
Prompt: "Something about food"
Response:
{
  "name": "Food Campaign",
  "description": "TBD",
  "category": "Unknown",
  "businessName": "Unknown",
  "website": "",
  "email": "",
  "phone": "",
  "surveyQuestions": [
    "What do you think of this campaign?",
    "How can we improve it?"
  ]
}

Now, generate a JSON object based on the following prompt:
`;

// Default campaign data as a fallback
const DEFAULT_CAMPAIGN_DATA = {
  name: "Unknown Campaign",
  description: "TBD",
  category: "Unknown",
  businessName: "Unknown",
  website: "",
  email: "",
  phone: "",
  surveyQuestions: [
    "What do you think of this campaign?",
    "How can we improve it?"
  ]
};

// POST endpoint to generate campaign data
router.post('/generate-campaign', async (req, res) => {
  const { prompt } = req.body;

  // Log the received prompt
  console.log('Received prompt:', prompt);

  // Validate input
  if (!prompt || typeof prompt !== 'string') {
    console.log('Invalid prompt received, using defaults');
    return res.status(200).json({
      status: 'error',
      message: 'A string prompt is required',
      campaignData: DEFAULT_CAMPAIGN_DATA
    });
  }

  let campaignData = { ...DEFAULT_CAMPAIGN_DATA };
  let responseStatus = 'success';
  let errorMessage = null;

  try {
    const fullPrompt = PREPROMPT + prompt;

    // Call Gemini API
    const response = await axios.post(
      GEMINI_API_URL,
      {
        contents: [
          {
            parts: [
              { text: fullPrompt }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        }
      }
    );

    // Log the raw Gemini API response
    console.log('Gemini API Response:', response.data);

    // Inside the try block after calling the Gemini API
    const generatedText = response.data.candidates[0].content.parts[0].text;

    // Remove markdown code block indicators if present
    const jsonMatch = generatedText.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1].trim() : generatedText.trim();

    try {
    const parsedData = JSON.parse(jsonText);
    campaignData = {
        ...DEFAULT_CAMPAIGN_DATA,
        ...parsedData,
        surveyQuestions: Array.isArray(parsedData.surveyQuestions) && parsedData.surveyQuestions.length > 0
        ? parsedData.surveyQuestions
        : DEFAULT_CAMPAIGN_DATA.surveyQuestions
    };
    } catch (parseError) {
    console.error('Failed to parse Gemini response as JSON:', jsonText);
    responseStatus = 'error';
    errorMessage = 'Invalid JSON from Gemini API';
    }
  } catch (error) {
    console.error('Error calling Gemini API:', error.message);
    responseStatus = 'error';
    errorMessage = error.message || 'Failed to communicate with Gemini API';
    // Use default data
  }

  // Ensure all required fields are present
  const requiredFields = ['name', 'description', 'category', 'businessName', 'website', 'email', 'phone', 'surveyQuestions'];
  requiredFields.forEach((field) => {
    if (!campaignData.hasOwnProperty(field) || campaignData[field] === undefined || campaignData[field] === null) {
      campaignData[field] = DEFAULT_CAMPAIGN_DATA[field];
    }
  });

  // Construct and send response
  const jsonResponse = {
    status: responseStatus,
    campaignData
  };
  if (errorMessage) {
    jsonResponse.message = errorMessage;
  }

  res.status(200).json(jsonResponse);
});

module.exports = router;