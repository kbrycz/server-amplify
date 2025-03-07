const admin = require('./firebase'); // Import the initialized Firebase instance

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('Authorization header:', authHeader); // Debug token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send('Unauthorized: No token provided');
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    console.log('Decoded UID:', decodedToken.uid); // Debug UID
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(401).send('Unauthorized: Invalid token');
  }
};

module.exports = { verifyToken };