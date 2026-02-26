const express = require('express');
const router = express.Router();
const Route = require('../models/Route');
const Stop = require('../models/Stop');
const authMiddleware = require('../middleware/auth');

// GET all routes (public)
router.get('/', async (req, res) => {
  try {
    const routes = await Route.find({ isActive: true })
      .populate('stops.stop', 'name stopCode location address');
    res.json(routes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET single route with all stops
router.get('/:id', async (req, res) => {
  try {
    const route = await Route.findById(req.params.id)
      .populate('stops.stop');
    if (!route) return res.status(404).json({ message: 'Route not found' });
    res.json(route);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create route (admin only)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, routeNumber, description, stops } = req.body;

    const route = new Route({ name, routeNumber, description, stops });
    await route.save();

    // Update each stop to include this route reference
    for (const stopEntry of stops) {
      await Stop.findByIdAndUpdate(stopEntry.stop, {
        $addToSet: { routes: route._id }
      });
    }

    res.status(201).json(route);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT update route
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const route = await Route.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(route);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

// DELETE /api/routes/:id  (admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const route = await Route.findByIdAndDelete(req.params.id);
    if (!route) return res.status(404).json({ message: 'Route not found' });

    // Remove this route reference from all stops
    await Stop.updateMany(
      { routes: req.params.id },
      { $pull: { routes: route._id } }
    );

    // Unassign route from any buses using it
    const Bus = require('../models/Bus');
    await Bus.updateMany({ route: req.params.id }, { route: null });

    res.json({ message: `Route "${route.routeNumber} — ${route.name}" deleted.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});