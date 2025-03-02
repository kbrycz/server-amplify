const express = require('express');
const cors = require('cors');
const admin = require('./firebase'); // Import the initialized Firebase instance
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const campaignRoutes = require('./routes/campaign');
const campaignAIRoutes = require('./routes/campaign-ai');
const surveyRoutes = require('./routes/survey');
const draftCampaignRoutes = require('./routes/draftCampaign');
const videoEditorRoutes = require('./routes/videoEditor');
const videoProcessorRoutes = require('./routes/videoProcessor');
const representativesRoutes = require('./routes/representatives'); // Add this line
const videoEnhancerRoutes = require('./routes/video-enhancer');
const thumbnailEndpoint = require('./routes/thumbnailEndpoint');
const recentActivity = require('./routes/recentActivity');
const alertsRoutes = require('./routes/alerts');

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
app.use('/representatives', representativesRoutes); // Add this line
app.use('/videoEnhancer', videoEnhancerRoutes);
app.use('/thumbnailEndpoint', thumbnailEndpoint);
app.use('/activity', recentActivity);
app.use('/alerts', alertsRoutes);


app.get('/', (req, res) => {
  res.send('Welcome to the API');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});