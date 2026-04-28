const mongoose = require("mongoose");
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI;

async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

module.exports = {
  connectDB
};
