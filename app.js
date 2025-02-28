const express = require('express');
const cors = require('cors');
const admin = require('./firebase'); // Import the initialized Firebase instance
const authRoutes = require('./auth');
const userRoutes = require('./user');
const campaignRoutes = require('./campaign');
const campaignAIRoutes = require('./campaign-ai');
const surveyRoutes = require('./survey');
const draftCampaignRoutes = require('./draftCampaign');
const videoEditorRoutes = require('./videoEditor');
const videoProcessorRoutes = require('./videoProcessor');

const app = express();
app.use(express.json());
app.use(cors({
    origin: '*', // In production, restrict to your domain
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Mount the routes
app.use('/campaign', campaignRoutes);
app.use('/campaign', campaignAIRoutes);
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/survey', surveyRoutes);
app.use('/draftCampaign', draftCampaignRoutes);
app.use('/videoEditor', videoEditorRoutes);
app.use('/videoProcessor', videoProcessorRoutes);


app.get('/', (req, res) => {
  res.send('Welcome to the API');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});