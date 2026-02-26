const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const Stop = require('../models/Stop');
const authMiddleware = require('../middleware/auth');

// GET all stops (public)
router.get('/', async (req, res) => {
  try {
    const stops = await Stop.find({ isActive: true }).populate('routes', 'name routeNumber');
    res.json(stops);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET single stop by ID (public) - used when QR is scanned
router.get('/:id', async (req, res) => {
  try {
    const stop = await Stop.findById(req.params.id).populate('routes', 'name routeNumber');
    if (!stop) return res.status(404).json({ message: 'Stop not found' });
    res.json(stop);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET stop by stopCode (alternative lookup)
router.get('/code/:stopCode', async (req, res) => {
  try {
    const stop = await Stop.findOne({ stopCode: req.params.stopCode }).populate('routes', 'name routeNumber');
    if (!stop) return res.status(404).json({ message: 'Stop not found' });
    res.json(stop);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create stop and auto-generate QR code (admin only)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, stopCode, latitude, longitude, address } = req.body;

    const stop = new Stop({
      name,
      stopCode,
      address,
      location: {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      }
    });

    await stop.save();

    // QR points to the PASSENGER frontend (separate app on port 3001)
    const passengerUrl = process.env.PASSENGER_FRONTEND_URL || 'http://localhost:3001';
    const qrUrl = `${passengerUrl}/stop/${stop._id}`;
    const qrBase64 = await QRCode.toDataURL(qrUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });

    stop.qrCode = qrBase64;
    await stop.save();

    res.status(201).json({ stop, qrUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET regenerate QR for a stop
router.get('/:id/qr', async (req, res) => {
  try {
    const stop = await Stop.findById(req.params.id);
    if (!stop) return res.status(404).json({ message: 'Stop not found' });

    const passengerUrl = process.env.PASSENGER_FRONTEND_URL || 'http://localhost:3001';
    const qrUrl = `${passengerUrl}/stop/${stop._id}`;
    const qrBase64 = await QRCode.toDataURL(qrUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });

    stop.qrCode = qrBase64;
    await stop.save();

    res.json({ qrCode: qrBase64, qrUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT update stop
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const stop = await Stop.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(stop);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

// DELETE /api/stops/:id  (admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const stop = await Stop.findByIdAndDelete(req.params.id);
    if (!stop) return res.status(404).json({ message: 'Stop not found' });

    // Remove this stop from all routes that reference it
    const Route = require('../models/Route');
    await Route.updateMany(
      { 'stops.stop': req.params.id },
      { $pull: { stops: { stop: req.params.id } } }
    );

    res.json({ message: `Stop "${stop.name}" deleted.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});