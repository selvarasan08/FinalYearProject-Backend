const mongoose = require('mongoose');

const busSchema = new mongoose.Schema({
  busNumber: { type: String, required: true, unique: true }, // e.g. "TN-01-AB-1234"
  busName: { type: String },                                 // e.g. "Express 42"
  route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  capacity: { type: Number, default: 50 },

  // Live tracking fields
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
  },
  speed: { type: Number, default: 0 },              // km/h
  heading: { type: Number, default: 0 },            // degrees 0-360
  isActive: { type: Boolean, default: false },      // is bus currently running
  lastUpdated: { type: Date, default: Date.now },

  // Which stop index the bus is currently near/heading to
  nextStopIndex: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now }
});

busSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('Bus', busSchema);