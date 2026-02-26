const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ─── Register ─────────────────────────────────────────────────────────────────
// POST /api/auth/register
// Body: { name, phone, password }
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ message: 'Name, phone, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(400).json({ message: 'This phone number is already registered. Please login.' });
    }

    const user = new User({ name, phone, password });
    await user.save();

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Body: { phone, password }
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: 'Phone and password are required' });
    }

    const user = await User.findOne({ phone }).populate('assignedBus');
    if (!user) {
      return res.status(400).json({ message: 'No account found with this phone number.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect password.' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        assignedBus: user.assignedBus
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;


// ─── Setup: Create FIRST admin (only works when zero admins exist) ─────────────
// POST /api/auth/setup
// Body: { name, phone, password }
// No auth required — but blocked once any admin exists in DB
const adminOnly = require('../middleware/adminOnly');

router.post('/setup', async (req, res) => {
  try {
    // Block if any admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      return res.status(403).json({
        message: 'Setup already complete. Use /create-admin with an admin token to add more admins.'
      });
    }

    const { name, phone, password } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ message: 'Name, phone, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(400).json({ message: 'This phone number is already registered.' });
    }

    const admin = new User({ name, phone, password, role: 'admin' });
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, role: admin.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'First admin created successfully!',
      token,
      user: { id: admin._id, name: admin.name, phone: admin.phone, role: admin.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Create Admin (existing admin only) ──────────────────────────────────────
// POST /api/auth/create-admin
// Headers: Authorization: Bearer <admin_token>
// Body: { name, phone, password }
router.post('/create-admin', adminOnly, async (req, res) => {
  try {
    const { name, phone, password } = req.body;

    if (!name || !phone || !password) {
      return res.status(400).json({ message: 'Name, phone, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(400).json({ message: 'This phone number is already registered.' });
    }

    const admin = new User({ name, phone, password, role: 'admin' });
    await admin.save();

    res.status(201).json({
      message: `Admin "${admin.name}" created successfully.`,
      user: { id: admin._id, name: admin.name, phone: admin.phone, role: admin.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── List all admins (admin only) ────────────────────────────────────────────
// GET /api/auth/admins
// Headers: Authorization: Bearer <admin_token>
router.get('/admins', adminOnly, async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }, '-password');
    res.json(admins);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Delete an admin (admin only, cannot delete self) ────────────────────────
// DELETE /api/auth/admins/:id
// Headers: Authorization: Bearer <admin_token>
router.delete('/admins/:id', adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own admin account.' });
    }
    const admin = await User.findOneAndDelete({ _id: req.params.id, role: 'admin' });
    if (!admin) return res.status(404).json({ message: 'Admin not found.' });
    res.json({ message: `Admin "${admin.name}" deleted.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});