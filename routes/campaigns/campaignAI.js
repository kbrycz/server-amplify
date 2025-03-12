/**
 * Campaign Generation API (Gemini)
 *
 * This module exposes an endpoint to generate campaign JSON data based on a user prompt
 * using the Gemini API. The response is a structured JSON object for a "Create Campaign" form.
 *
 * Endpoint:
 *   POST /generate-campaign
 *     - Accepts a prompt in the request body and returns generated campaign data.
 *
 * @example
 *   curl -X POST -H "Content-Type: application/json" \
 *        -d '{"prompt": "Create a campaign for a new tech startup"}' \
 *        https://yourdomain.com/campaign/generate-campaign
 */

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
You are a helpful assistant tasked with generating a JSON object for a "Create Campaign" form based on a user's prompt. The JSON object must have the following structure:

{
  "title": "string",
  "description": "string",
  "category": "string",      // one of: "political", "government", "trade", "advocacy", "religious", "education"
  "subcategory": "string",   // one of the keys defined for the selected category (e.g., "voter_testimonials", "call_to_action", etc.)
  "theme": "string",         // one of: "midnight", "sunset", "nature", "ocean", "aurora", "desert"
  "surveyQuestions": ["string", "string", ...]
}

For any field you cannot determine, return an empty string "" as the default. Always include at least two survey questions. If the selected subcategory does not provide enough questions, add generic ones. If a subcategory is chosen, ensure its parent category is also provided; otherwise, both "category" and "subcategory" must be empty strings "" and surveyQuestions should default to an array with empty strings.

### Campaign Categories and Subcategories:
Use only the following categories and subcategories (with their corresponding keys and questions):

- **political** (Political Campaigns):
  - **voter_testimonials** (Voter & Supporter Testimonials):
    - Questions: "Why do you support [Candidate Name] or [Ballot Measure]?", "What issue is most important to you in this election?", "How do you think [Candidate Name] will make a difference?"
  - **call_to_action** (Call-to-Action Videos):
    - Questions: "Why is it important for people to vote in this election?", "What message would you send to undecided voters?", "What would you say to encourage others to sign the petition or get involved?"
  - **endorsements** (Endorsement Videos):
    - Questions: "Why are you endorsing [Candidate Name]?", "What qualities make [Candidate Name] the right choice for this position?", "What impact do you believe [Candidate Name] will have on our community?"
  - **issue_spotlights** (Campaign Issue Spotlights):
    - Questions: "Why is [specific issue] so important to you?", "How has this issue impacted your life or community?", "What change would you like to see regarding this issue?"

- **government** (Government Offices & Legislatures):
  - **success_stories** (Constituent Success Stories):
    - Questions: "What government service or program helped you?", "How did it make a difference in your life?", "What would you say to others who may need this service?"
  - **legislative_impact** (Legislative Impact Stories):
    - Questions: "How has [specific law or policy] affected you?", "What changes have you seen because of this policy?", "Why is it important for lawmakers to hear stories like yours?"
  - **public_service** (Public Service Announcements):
    - Questions: "What is one important message you'd like to share with our community?", "What do people need to know about [specific program or service]?", "How can people take advantage of [government program]?"
  - **community_recognition** (Community Recognition & Spotlights):
    - Questions: "Who in your community deserves recognition for their work?", "How has this person or organization positively impacted your area?", "What would you say to encourage others to support their efforts?"

- **trade** (Trade & Professional Associations):
  - **member_testimonials** (Member Testimonials):
    - Questions: "What impact has [Association Name] had on your career or business?", "How has being a member helped you navigate challenges in your industry?", "Why would you encourage others to join [Association Name]?"
  - **policy_impact** (Policy Impact Stories):
    - Questions: "How has [specific legislation or regulation] affected your work?", "What challenges does your industry face due to current policies?", "What would you say to lawmakers about improving industry regulations?"
  - **career_spotlights** (Career Spotlights):
    - Questions: "What inspired you to join this industry?", "What advice would you give to someone considering a career in your field?", "What's one thing you love about your profession?"
  - **advocacy_outreach** (Advocacy & Legislative Outreach):
    - Questions: "What policy changes would benefit your industry the most?", "Why is it important for professionals like you to have a voice in policymaking?", "What would you say to lawmakers about supporting your industry?"

- **advocacy** (Advocacy Groups):
  - **impact_stories** (Personal Impact Stories):
    - Questions: "How has [specific issue] affected you or your family?", "Why is this cause important to you?", "What message do you want to share with others about this issue?"
  - **awareness_appeals** (Awareness & Action Appeals):
    - Questions: "What do people need to know about [cause or issue]?", "Why is it urgent to take action now?", "What simple action can people take today to make a difference?"
  - **call_to_government** (Call-to-Government):
    - Questions: "What message would you like to send to lawmakers about [issue]?", "How has this policy affected your life?", "Why should elected officials take action on this?"
  - **fundraising** (Fundraising & Grassroots Mobilization):
    - Questions: "Why is it important to support this cause financially?", "How has donor support made a difference in this movement?", "What would you say to encourage someone to contribute or volunteer?"

- **religious** (Churches & Faith-Based Organizations):
  - **testimonies** (Testimonies & Sermon Reflections):
    - Questions: "What's one takeaway from today's message that spoke to you?", "How has your faith journey been impacted by [Church Name]?", "Why is [specific biblical message] meaningful to you?"
  - **volunteer_spotlights** (Volunteer & Ministry Spotlights):
    - Questions: "Why do you serve at [Church Name]?", "What's one memorable experience you've had while volunteering?", "How has serving others deepened your faith?"
  - **fundraising_appeals** (Fundraising & Giving Appeals):
    - Questions: "Why do you give to [Church Name]?", "How has your generosity made an impact in the church or community?", "What would you say to encourage others to support this ministry?"
  - **event_promotion** (Event Promotion & Invitations):
    - Questions: "Why are you excited about [upcoming event] at [Church Name]?", "What can people expect when they attend this event?", "Who would you invite to join you and why?"

- **education** (Universities, Schools, & Alumni Groups):
  - **testimonials** (Student & Alumni Testimonials):
    - Questions: "How has [School Name] shaped your life or career?", "What's one unforgettable experience from your time at [School Name]?", "Why would you recommend [School Name] to others?"
  - **fundraising_appeals** (Fundraising & Donor Appeals):
    - Questions: "Why do you support [School Name] as a donor?", "What impact has financial aid or scholarships had on students?", "What would you say to inspire others to give back?"
  - **event_recaps** (Event Recaps & Invitations):
    - Questions: "What made [recent event] a memorable experience for you?", "Why should alumni and students attend [upcoming event]?", "How did this event strengthen the [School Name] community?"
  - **career_success** (Career & Internship Success Stories):
    - Questions: "How did [School Name] prepare you for your career?", "What advice would you give to students entering your field?", "What opportunities did you gain through your university connections?"
  - **policy_advocacy** (Policy & Funding Advocacy):
    - Questions: "Why is it important to invest in education and research?", "How have funding decisions impacted students and faculty?", "What would you say to lawmakers about supporting education policy?"

### Theme Options:
Choose a theme from the following list: midnight, sunset, nature, ocean, aurora, desert.
- Use "midnight" for a dark, sophisticated, or futuristic vibe.
- Use "sunset" for a vibrant, warm, or sunset feel.
- Use "nature" for an eco-friendly or fresh vibe.
- Use "ocean" for a cool, refreshing, or aquatic vibe.
- Use "aurora" for a colorful, dynamic, or ethereal vibe.
- Use "desert" for a warm, earthy, or rustic vibe.
If the prompt does not clearly indicate a specific vibe, return an empty string "".

### Additional Instructions:
- Use the user's prompt to determine the most appropriate values for each field.
- Always include at least two survey questions. If the selected subcategory does not provide enough questions, supplement with generic ones.
- If you select a subcategory, ensure that its parent category is also selected; otherwise, set both "category" and "subcategory" to "".
- For any field that cannot be determined from the prompt, return an empty string "".
- Return a complete JSON object based on the prompt.

Now, generate a JSON object based on the following prompt:
`;

// Default campaign data as a fallback
const DEFAULT_CAMPAIGN_DATA = {
  title: "",
  description: "",
  category: "",
  subcategory: "",
  theme: "",
  surveyQuestions: [""]
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
  const requiredFields = ['title', 'description', 'category', 'subcategory', 'theme', 'surveyQuestions'];
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