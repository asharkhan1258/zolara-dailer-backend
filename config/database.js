const mongoose = require('mongoose');

const connectDB = async (retries = 5, delay = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const conn = await mongoose.connect('mongodb+srv://saad:Saad@8212@cluster0.irhxo3y.mongodb.net/zolara-dialer', {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });

      console.log(`MongoDB Connected: ${conn.connection.host}`);
      return; // Exit function once connected
    } catch (error) {
      console.error(`MongoDB Connection Failed. Attempt ${i + 1} of ${retries}. Error: ${error.message}`);

      if (i < retries - 1) {
        console.log(`Retrying connection in ${delay / 1000} seconds...`);
        await new Promise((res) => setTimeout(res, delay)); // Wait before retrying
      } else {
        console.error('All connection attempts failed. Exiting...');
        process.exit(1); // Exit the application if all retries fail
      }
    }
  }
};

module.exports = connectDB;
