const express = require('express');
const cors = require('cors');
const admin = require('./firebase'); // Import the initialized Firebase instance
const authRoutes = require('./auth');
const userRoutes = require('./user');
const campaignRoutes = require('./campaign');
const campaignAIRoutes = require('./campaign-ai');
const surveyRoutes = require('./survey');

const app = express();
app.use(express.json());
app.use(cors({
    origin: '*', // In production, restrict to your domain
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }));

// Mount the campaign routes under '/campaign'
app.use('/campaign', campaignRoutes);
app.use('/campaign', campaignAIRoutes);
app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/survey', surveyRoutes);

app.get('/', (req, res) => {
  res.send('Welcome to the API');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});