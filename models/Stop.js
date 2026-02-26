const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema({
  name: { type: String, required: true },        // e.g. "Central Station"
  stopCode: { type: String, required: true, unique: true }, // e.g. "STOP_001"
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  address: { type: String },
  qrCode: { type: String },   // base64 QR image stored here
  routes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Route' }], // which routes serve this stop
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Geospatial index for distance queries
stopSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Stop', stopSchema);