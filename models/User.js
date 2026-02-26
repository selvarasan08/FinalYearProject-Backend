const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: {
    type: String,
    required: true,
    unique: true,
    match: [/^\+?[0-9]{10,15}$/, 'Enter a valid phone number']
  },
  password: { type: String, required: true },
  role: { type: String, enum: ['driver', 'admin'], default: 'driver' },
  assignedBus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus' },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);