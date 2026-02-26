const express = require('express');
const router = express.Router();
const Bus = require('../models/Bus');
const Stop = require('../models/Stop');
const Route = require('../models/Route');
const authMiddleware = require('../middleware/auth');

// Haversine formula - calculate distance between two lat/lng points in km
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Calculate ETA in minutes from bus current location to a target stop
function calculateETA(busLat, busLon, stopLat, stopLon, speedKmh) {
  const distance = haversineDistance(busLat, busLon, stopLat, stopLon);
  const effectiveSpeed = speedKmh > 5 ? speedKmh : 20; // fallback 20km/h if stopped/slow
  const timeHours = distance / effectiveSpeed;
  return {
    distanceKm: Math.round(distance * 100) / 100,
    etaMinutes: Math.round(timeHours * 60)
  };
}

// GET /api/buses/all - Get ALL buses regardless of status (admin)
router.get("/all", authMiddleware, async (req, res) => {
  try {
    const buses = await Bus.find()
      .populate("route", "name routeNumber")
      .populate("driver", "name phone");
    res.json(buses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/buses - Get all active buses (public)
router.get('/', async (req, res) => {
  try {
    // Auto mark buses inactive if no update in 2 minutes
    await Bus.updateMany(
      { lastUpdated: { $lt: new Date(Date.now() - 2 * 60 * 1000) }, isActive: true },
      { isActive: false }
    );

    const buses = await Bus.find({ isActive: true })
      .populate('route', 'name routeNumber stops')
      .populate('driver', 'name');

    res.json(buses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/buses/stop/:stopId - Get buses coming to a specific stop with ETA
// This is the endpoint called when passenger scans QR code
router.get('/stop/:stopId', async (req, res) => {
  try {
    const stop = await Stop.findById(req.params.stopId).populate('routes');
    if (!stop) return res.status(404).json({ message: 'Stop not found' });

    const stopLat = stop.location.coordinates[1];
    const stopLon = stop.location.coordinates[0];

    // Find all active buses whose route includes this stop
    const routeIds = stop.routes.map(r => r._id);
    const buses = await Bus.find({
      isActive: true,
      route: { $in: routeIds }
    }).populate({
      path: 'route',
      populate: { path: 'stops.stop' }
    }).populate('driver', 'name');

    // For each bus, check if the stop is AHEAD of the bus (not already passed)
    // and calculate ETA
    const busesWithETA = [];

    for (const bus of buses) {
      const route = bus.route;
      if (!route || !route.stops) continue;

      // Find this stop's order in the route
      const targetStopInRoute = route.stops.find(
        s => s.stop && s.stop._id.toString() === req.params.stopId
      );
      if (!targetStopInRoute) continue;

      // Only show bus if the target stop is ahead of the bus's current progress
      if (targetStopInRoute.order < bus.nextStopIndex) continue;

      const busLat = bus.currentLocation.coordinates[1];
      const busLon = bus.currentLocation.coordinates[0];
      const { distanceKm, etaMinutes } = calculateETA(busLat, busLon, stopLat, stopLon, bus.speed);

      // Build ordered route polyline with all stop coordinates
      const routePolyline = route.stops
        .filter(s => s.stop && s.stop.location)
        .sort((a, b) => a.order - b.order)
        .map(s => ({
          name: s.stop.name,
          stopCode: s.stop.stopCode,
          order: s.order,
          lat: s.stop.location.coordinates[1],
          lng: s.stop.location.coordinates[0],
          isScannedStop: s.stop._id.toString() === req.params.stopId,
          isPassed: s.order < bus.nextStopIndex,
        }));

      busesWithETA.push({
        _id: bus._id,
        busNumber: bus.busNumber,
        busName: bus.busName,
        routeName: route.name,
        routeNumber: route.routeNumber,
        driver: bus.driver?.name || 'Unknown',
        currentLocation: bus.currentLocation,
        speed: bus.speed,
        distanceKm,
        etaMinutes,
        lastUpdated: bus.lastUpdated,
        stopsAway: targetStopInRoute.order - bus.nextStopIndex,
        routePolyline, // ordered stop coordinates for map
      });
    }

    // Sort by ETA
    busesWithETA.sort((a, b) => a.etaMinutes - b.etaMinutes);

    res.json({
      stop: {
        _id: stop._id,
        name: stop.name,
        stopCode: stop.stopCode,
        address: stop.address
      },
      buses: busesWithETA
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/buses/:id - Get single bus details
router.get('/:id', async (req, res) => {
  try {
    const bus = await Bus.findById(req.params.id)
      .populate('route')
      .populate('driver', 'name email');
    if (!bus) return res.status(404).json({ message: 'Bus not found' });
    res.json(bus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/buses - Create bus (admin only)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const bus = new Bus(req.body);
    await bus.save();
    res.status(201).json(bus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/buses/:id - Update bus (admin only)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const bus = await Bus.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(bus);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

// DELETE /api/buses/:id  (admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const User = require('../models/User');
    const bus = await Bus.findByIdAndDelete(req.params.id);
    if (!bus) return res.status(404).json({ message: 'Bus not found' });

    // Unassign from driver if assigned
    if (bus.driver) {
      await User.findByIdAndUpdate(bus.driver, { assignedBus: null });
    }

    res.json({ message: `Bus "${bus.busNumber}" deleted.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});