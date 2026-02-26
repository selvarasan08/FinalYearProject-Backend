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

// GET /api/buses/stop/:stopId
// Optional query: ?passengerLat=13.08&passengerLng=80.27
//
// PASSENGER MODE (when lat/lng provided):
//   - Bus ETA calculated bus → passenger position
//   - Walking distance + time calculated passenger → stop (5 km/h walk)
//   - totalJourneyMinutes = bus ETA + walk time (full door-to-bus time)
//   - Passenger dot shown on map, dashed walk line drawn to stop
//
// STOP MODE (no passenger coords):
//   - Bus ETA calculated bus → stop  (original behaviour)
router.get('/stop/:stopId', async (req, res) => {
  try {
    const stop = await Stop.findById(req.params.stopId).populate('routes');
    if (!stop) return res.status(404).json({ message: 'Stop not found' });

    const stopLat = stop.location.coordinates[1];
    const stopLon = stop.location.coordinates[0];

    // --- Optional passenger location ---
    const pLat = req.query.passengerLat ? parseFloat(req.query.passengerLat) : null;
    const pLng = req.query.passengerLng ? parseFloat(req.query.passengerLng) : null;
    const hasPassenger = pLat !== null && pLng !== null && !isNaN(pLat) && !isNaN(pLng);

    // Walking: passenger → stop at 5 km/h
    let walkingDistanceKm = 0;
    let walkingMinutes    = 0;
    if (hasPassenger) {
      walkingDistanceKm = Math.round(haversineDistance(pLat, pLng, stopLat, stopLon) * 100) / 100;
      walkingMinutes    = Math.ceil((walkingDistanceKm / 5) * 60);
    }

    // Bus ETA target: passenger position if available, else the stop itself
    const etaTargetLat = hasPassenger ? pLat : stopLat;
    const etaTargetLon = hasPassenger ? pLng : stopLon;

    const routeIds = stop.routes.map(r => r._id);
    const buses = await Bus.find({
      isActive: true,
      route: { $in: routeIds }
    }).populate({
      path: 'route',
      populate: { path: 'stops.stop' }
    }).populate('driver', 'name');

    const busesWithETA = [];

    for (const bus of buses) {
      const route = bus.route;
      if (!route || !route.stops) continue;

      const targetStopInRoute = route.stops.find(
        s => s.stop && s.stop._id.toString() === req.params.stopId
      );
      if (!targetStopInRoute) continue;
      if (targetStopInRoute.order < bus.nextStopIndex) continue;

      const busLat = bus.currentLocation.coordinates[1];
      const busLon = bus.currentLocation.coordinates[0];

      // Primary ETA: bus → passenger (or stop)
      const { distanceKm, etaMinutes } = calculateETA(busLat, busLon, etaTargetLat, etaTargetLon, bus.speed);

      // Always also calculate bus → stop distance for display
      const distanceToStop = Math.round(haversineDistance(busLat, busLon, stopLat, stopLon) * 100) / 100;

      // Full journey time a passenger experiences: wait for bus + walk to stop
      const totalJourneyMinutes = hasPassenger ? etaMinutes + walkingMinutes : etaMinutes;

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
        distanceKm,           // bus → passenger (or stop if no passenger)
        distanceToStop,        // bus → stop (always)
        etaMinutes,            // bus ETA to passenger / stop
        totalJourneyMinutes,   // full passenger journey time
        lastUpdated: bus.lastUpdated,
        stopsAway: targetStopInRoute.order - bus.nextStopIndex,
        routePolyline,
      });
    }

    busesWithETA.sort((a, b) => a.etaMinutes - b.etaMinutes);

    res.json({
      stop: {
        _id: stop._id,
        name: stop.name,
        stopCode: stop.stopCode,
        address: stop.address,
        lat: stopLat,
        lng: stopLon,
      },
      passenger: hasPassenger
        ? { lat: pLat, lng: pLng, walkingDistanceKm, walkingMinutes }
        : null,
      buses: busesWithETA,
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