const express = require('express');
const cors = require('cors');
const admin = require('./firebase'); // Import the initialized Firebase instance
const authRoutes = require('./auth');
const userRoutes = require('./user');
const campaignRoutes = require('./campaign');

const app = express();

app.use(cors());
app.use(express.json());

// Mount the campaign routes under '/campaign'
app.use('/campaign', campaignRoutes);
app.use('/auth', authRoutes);
app.use('/user', userRoutes);

app.get('/', (req, res) => {
  res.send('Welcome to the API');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});