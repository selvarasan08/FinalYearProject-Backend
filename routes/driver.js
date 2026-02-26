const express = require('express');
const router = express.Router();
const Bus = require('../models/Bus');
const authMiddleware = require('../middleware/auth');

// Driver updates their live location (called every 10 seconds from driver's phone)
router.post('/update-location', authMiddleware, async (req, res) => {
  try {
    const { busId, latitude, longitude, speed, heading } = req.body;

    if (!busId || !latitude || !longitude) {
      return res.status(400).json({ message: 'busId, latitude, longitude are required' });
    }

    const bus = await Bus.findById(busId);
    if (!bus) return res.status(404).json({ message: 'Bus not found' });

    // Security: only the assigned driver can update this bus
    if (bus.driver?.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized for this bus' });
    }

    bus.currentLocation = {
      type: 'Point',
      coordinates: [parseFloat(longitude), parseFloat(latitude)]
    };
    bus.speed = speed || 0;
    bus.heading = heading || 0;
    bus.isActive = true;
    bus.lastUpdated = new Date();

    await bus.save();

    res.json({ message: 'Location updated', lastUpdated: bus.lastUpdated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Driver marks bus as offline (end of shift)
router.post('/end-shift', authMiddleware, async (req, res) => {
  try {
    const { busId } = req.body;
    const bus = await Bus.findById(busId);
    if (!bus) return res.status(404).json({ message: 'Bus not found' });

    bus.isActive = false;
    bus.nextStopIndex = 0;
    await bus.save();

    res.json({ message: 'Shift ended' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get assigned bus for logged-in driver
router.get('/my-bus', authMiddleware, async (req, res) => {
  try {
    const bus = await Bus.findOne({ driver: req.user.id }).populate('route');
    if (!bus) return res.status(404).json({ message: 'No bus assigned to you' });
    res.json(bus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

// GET /api/driver/all-drivers — list all registered drivers (admin only)
const adminOnly = require('../middleware/adminOnly');

router.get('/all-drivers', adminOnly, async (req, res) => {
  try {
    const User = require('../models/User');
    const drivers = await User.find({ role: 'driver' }, '-password')
      .populate('assignedBus', 'busNumber busName route isActive');
    res.json(drivers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/driver/assign-bus — assign or unassign a bus to a driver (admin only)
// Body: { driverId, busId }  — pass busId as null to unassign
router.post('/assign-bus', adminOnly, async (req, res) => {
  try {
    const { driverId, busId } = req.body;
    const User = require('../models/User');
    const Bus  = require('../models/Bus');

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver')
      return res.status(404).json({ message: 'Driver not found.' });

    // Unassign previous bus from this driver if any
    if (driver.assignedBus) {
      await Bus.findByIdAndUpdate(driver.assignedBus, { driver: null });
    }

    if (busId) {
      const bus = await Bus.findById(busId);
      if (!bus) return res.status(404).json({ message: 'Bus not found.' });

      // Unassign previous driver from target bus
      if (bus.driver && bus.driver.toString() !== driverId) {
        await User.findByIdAndUpdate(bus.driver, { assignedBus: null });
      }

      bus.driver = driverId;
      await bus.save();
      driver.assignedBus = busId;
    } else {
      driver.assignedBus = null;
    }

    await driver.save();

    const updated = await User.findById(driverId, '-password')
      .populate('assignedBus', 'busNumber busName route isActive');

    res.json({ message: 'Assignment updated.', driver: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});