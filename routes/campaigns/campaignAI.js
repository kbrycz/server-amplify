const express = require('express');
const axios = require('axios');
const router = express.Router();

// Load environment variables from .env file
require('dotenv').config();

// Use environment variable for the Gemini API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is not set');
}
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

// Preprompt to guide Gemini API to always return structured JSON
const PREPROMPT = `
You are a helpful assistant tasked with generating a JSON object for a "Create Campaign" form based on a user's prompt. The JSON must include the following fields:

{
  "title": "string",
  "description": "string",
  "category": "string",
  "subcategory": "string",
  "businessName": "string",
  "website": "string",
  "email": "string",
  "phone": "string",
  "theme": "string",
  "surveyQuestions": ["string", "string", ...]
}

Always return a complete JSON object, even if the prompt is incomplete or unclear. For fields you can't determine, use blank values like "" (empty string). For surveyQuestions, provide at least two generic questions if none are specified.

### Field Constraints:
- **"category"**: Must be one of: "political", "business", "nonprofit", "education", "social".
- **"subcategory"**: Must correspond to the selected "category" based on these options:
  - "political": ["federal", "state", "local"]
  - "business": ["retail", "service", "tech", "hospitality", "healthcare", "other"]
  - "nonprofit": ["environment", "education", "health", "social", "arts", "other"]
  - "education": ["k12", "university", "college", "vocational", "other"]
  - "social": ["lifestyle", "tech", "fashion", "food", "travel", "fitness", "other"]
  If the prompt doesn't specify a subcategory, choose "other" if available for the category, or the most generic option.
- **"theme"**: Must be one of: "sunset", "modern", "professional", "fun", "elegant", "friendly", "default". Choose a theme that matches the campaign's context or tone.

### Instructions:
- Use the prompt to infer the most appropriate values for each field.
- Ensure "subcategory" matches the selected "category" from the defined options.
- Select a "theme" that fits the campaign's purpose or vibe.

### Examples:
**Prompt**: "Create a campaign for a pet adoption event"
**Response**:
{
  "title": "Pet Adoption Event",
  "description": "A campaign to promote pet adoptions in the local community.",
  "category": "nonprofit",
  "subcategory": "other",
  "businessName": "Local Pet Shelter",
  "website": "https://petshelter.org",
  "email": "info@petshelter.org",
  "phone": "(555) 987-6543",
  "theme": "friendly",
  "surveyQuestions": [
    "What type of pet are you interested in?",
    "How did you hear about our event?"
  ]
}

**Prompt**: "Campaign for a new tech startup"
**Response**:
{
  "title": "Tech Startup Launch",
  "description": "Introducing our innovative tech solutions to the market.",
  "category": "business",
  "subcategory": "tech",
  "businessName": "Tech Innovate",
  "website": "https://techinnovate.com",
  "email": "contact@techinnovate.com",
  "phone": "(555) 123-4567",
  "theme": "modern",
  "surveyQuestions": [
    "What do you think of our product?",
    "How can we serve you better?"
  ]
}

**Prompt**: "Something vague"
**Response**:
{
  "title": "",
  "description": "",
  "category": "",
  "subcategory": "",
  "businessName": "",
  "website": "",
  "email": "",
  "phone": "",
  "theme": "",
  "surveyQuestions": [
    ""
  ]
}

Now, generate a JSON object based on the following prompt:
`;

// Default campaign data as a fallback
const DEFAULT_CAMPAIGN_DATA = {
  title: "",
  description: "",
  category: "",
  subcategory: "",
  businessName: "",
  website: "",
  email: "",
  phone: "",
  theme: "",
  surveyQuestions: [
    ""
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

    // Extract and parse the generated text
    const generatedText = response.data.candidates[0].content.parts[0].text;
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
  }

  // Ensure all required fields are present
  const requiredFields = ['title', 'description', 'category', 'subcategory', 'businessName', 'website', 'email', 'phone', 'theme', 'surveyQuestions'];
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