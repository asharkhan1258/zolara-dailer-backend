const mongoose = require("mongoose");
require("dotenv").config();

// Set mongoose options
mongoose.set('strictQuery', false);  // Option for MongoDB schema query behavior
if (process.env.NODE_ENV === 'development') {
  mongoose.set("debug", true);
}

// Retry logic for MongoDB connection
const connectDB = async (retries = 5, delay = 2000) => {
  while (retries) {
    try {
      // Try to connect to MongoDB with the correct options
      await mongoose.connect(process.env.DB_CONNECTION, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        keepAlive: true,  // Enable MongoDB connection keep-alive
        // serverSelectionTimeoutMS: 5000,  // Set server selection timeout to 5 seconds
        // socketTimeoutMS: 45000,  // Set socket timeout to 45 seconds
        // maxPoolSize: 20,  // Increase connection pool size for concurrent requests
      });
      console.log('Database connection established');
      return;  // Exit if connection is successful
    } catch (error) {
      retries -= 1;  // Decrease retries
      console.error(`Error connecting to database. Retries left: ${retries}`, error.message);

      if (retries > 0) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, delay)); // Wait before retrying
      } else {
        console.error('Could not connect to the database after multiple attempts');
        process.exit(1);  // Exit the process after all retries fail
      }
    }
  }
};

// Handle connection errors during runtime
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
  console.log('Attempting to reconnect...');
  connectDB();
});

// Handle successful reconnections
mongoose.connection.on('connected', () => {
  console.log('MongoDB reconnected');
});

// Initial connection attempt
connectDB();

module.exports = connectDB;
