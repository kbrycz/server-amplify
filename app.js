const express = require('express');
const cors = require('cors');
const admin = require('./config/firebase'); // Import the initialized Firebase instance

// Updated imports based on the new folder structure
const authRoutes = require('./routes/auth/auth');
const userRoutes = require('./routes/account/user');
const campaignRoutes = require('./routes/campaigns/campaign');
const campaignAIRoutes = require('./routes/campaigns/campaignAI');
const draftCampaignRoutes = require('./routes/campaigns/draftCampaign');
const representativesRoutes = require('./routes/civic/representatives');
const surveyRoutes = require('./routes/media/survey');
const videoEditorRoutes = require('./routes/media/videoEditor');
const thumbnailEndpoint = require('./routes/media/thumbnailEndpoint');
const recentActivity = require('./routes/activity/recentActivity');
const alertsRoutes = require('./routes/activity/alerts');
const stripeRoutes = require('./routes/stripe/stripe');
const templatesRoutes = require('./routes/templates/templates');
const draftTemplatesRoutes = require('./routes/templates/draftTemplates');
const creatomateProcessRoutes = require('./routes/creatomate/creatomateProcess');
const dashboardRoutes = require('./routes/dashboard/dashboard');
const healthRoutes = require('./routes/health/health');
const namespacesRoutes = require('./routes/namespaces/namespaces');


const app = express();

// Global CORS configuration
const corsOptions = {
  origin: '*', // In production, use your frontend domain (e.g., 'https://yourdomain.com')
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Mount stripe routes with explicit CORS
app.use('/stripe', cors(corsOptions), stripeRoutes);

// Mount the routes
app.use('/campaign', campaignRoutes);
app.use('/campaign', campaignAIRoutes);
app.use('/draftCampaign', draftCampaignRoutes);
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/survey', surveyRoutes);
app.use('/videoEditor', videoEditorRoutes);
app.use('/representatives', representativesRoutes);
app.use('/thumbnailEndpoint', thumbnailEndpoint);
app.use('/activity', recentActivity);
app.use('/alerts', alertsRoutes);
app.use('/templates', templatesRoutes);
app.use('/draftTemplates', draftTemplatesRoutes);
app.use('/creatomate', creatomateProcessRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/health', healthRoutes);
app.use('/namespaces', namespacesRoutes);



app.get('/', (req, res) => {
  res.send('Welcome to the API');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});