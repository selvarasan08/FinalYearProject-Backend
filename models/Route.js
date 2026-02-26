const mongoose = require('mongoose');

// Each stop reference in a route has its order index
const routeStopSchema = new mongoose.Schema({
  stop: { type: mongoose.Schema.Types.ObjectId, ref: 'Stop', required: true },
  order: { type: Number, required: true }, // 0 = first stop
  distanceFromPrev: { type: Number, default: 0 } // km from previous stop
});

const routeSchema = new mongoose.Schema({
  name: { type: String, required: true },       // e.g. "Route 42 - Central to Airport"
  routeNumber: { type: String, required: true, unique: true }, // e.g. "42"
  description: { type: String },
  stops: [routeStopSchema],                     // ordered list of stops
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Route', routeSchema);