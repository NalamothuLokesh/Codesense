/**
 * MongoDB / Mongoose setup — users + review history
 */
const mongoose = require('mongoose');

// ── Connect with retry ────────────────────────────────────────────────────────
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in backend/.env');

  // Try both the SRV form and a fallback with directConnect options
  const options = {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
    socketTimeoutMS: 45000,
    family: 4, // Force IPv4 — avoids IPv6 DNS issues on Windows
  };

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      await mongoose.connect(uri, options);
      console.log('[db] Connected to MongoDB');
      return;
    } catch (err) {
      console.error(`[db] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const wait = attempt * 5000;
        console.log(`[db] Retrying in ${wait/1000}s…`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  console.error('[db] All retries exhausted. Server running without DB — fix MongoDB Atlas IP whitelist or network to enable auth.');
}

// ── User schema ───────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  email:                        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:                     { type: String, required: false }, // Optional for Google OAuth users
  name:                         { type: String, required: true, trim: true },
  role:                         { type: String, enum: ['USER', 'ADMIN', 'SUPER_ADMIN'], default: 'USER' },
  status:                       { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  tokenVersion:                 { type: Number, default: 0 },
  emailVerified:                { type: Boolean, default: false },
  authProvider:                 { type: String, enum: ['local', 'google'], default: 'local' },
  googleId:                     { type: String, default: null },
  avatar:                       { type: String, default: null },
  bio:                          { type: String, default: '' },
  notificationPreferences: {
    analysisCompleted:          { type: Boolean, default: true },
    criticalIssues:             { type: Boolean, default: true },
    securityAlerts:             { type: Boolean, default: true },
    emailNotifications:         { type: Boolean, default: true },
  },
  membershipPlan:               { type: String, enum: ['FREE', 'PRO', 'ENTERPRISE'], default: 'FREE' },
  verificationCodeHash:         { type: String, default: null },
  verificationCodeExpiresAt:    { type: Date,   default: null },
  verificationAttempts:         { type: Number, default: 0 },
  verificationResendAvailableAt:{ type: Date,   default: null },
  resendCount:                  { type: Number, default: 0 },
  resendWindowStart:            { type: Date,   default: null },
}, { timestamps: true });

userSchema.pre('validate', function(next) {
  if (this.role) {
    const upper = String(this.role).trim().toUpperCase();
    if (upper === 'SUPER_ADMIN' || upper === 'SUPERADMIN') this.role = 'SUPER_ADMIN';
    else if (upper === 'ADMIN') this.role = 'ADMIN';
    else this.role = 'USER';
  }
  if (this.status) {
    this.status = String(this.status).trim().toUpperCase() === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
  }
  if (this.membershipPlan) {
    const planUpper = String(this.membershipPlan).trim().toUpperCase();
    if (['FREE', 'PRO', 'ENTERPRISE'].includes(planUpper)) {
      this.membershipPlan = planUpper;
    } else {
      this.membershipPlan = 'FREE';
    }
  }
  next();
});

const User = mongoose.model('User', userSchema);

// ── Review schema ─────────────────────────────────────────────────────────────
const reviewSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  repo:       { type: String, required: true },
  branch:     { type: String, default: 'main' },
  status:     { type: String, enum: ['running', 'done', 'error'], default: 'running' },
  elapsedSec: { type: Number, default: null },
  markdown:   { type: String, default: null },
  error:      { type: String, default: null },
  finishedAt: { type: Date,   default: null },
}, { timestamps: true });

const Review = mongoose.model('Review', reviewSchema);

// ── Notification schema ───────────────────────────────────────────────────────
const notificationSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title:    { type: String, required: true },
  message:  { type: String, required: true },
  type:     { type: String, enum: ['analysis_completed', 'critical_issues', 'security_alert', 'system', 'subscription'], default: 'analysis_completed' },
  read:     { type: Boolean, default: false },
  link:     { type: String, default: null },
  repo:     { type: String, default: null },
  reviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'Review', default: null },
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);

// ── Audit Log schema ──────────────────────────────────────────────────────────
const auditLogSchema = new mongoose.Schema({
  action:      { type: String, required: true, index: true },
  actorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorEmail:  { type: String, default: null },
  actorRole:   { type: String, default: null },
  targetId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  targetEmail: { type: String, default: null },
  details:     { type: mongoose.Schema.Types.Mixed, default: {} },
  outcome:     { type: String, enum: ['SUCCESS', 'FAILURE'], default: 'SUCCESS' },
  ip:          { type: String, default: null },
}, { timestamps: true });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ── Subscription schema ───────────────────────────────────────────────────────
const subscriptionSchema = new mongoose.Schema({
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  plan:             { type: String, enum: ['FREE', 'PRO', 'ENTERPRISE'], default: 'FREE' },
  status:           { type: String, enum: ['ACTIVE', 'PENDING', 'PROCESSING', 'CANCELLED', 'EXPIRED', 'SUPERSEDED', 'FAILED'], default: 'ACTIVE', index: true },
  billingInterval:  { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
  amount:           { type: Number, default: 0 }, // in paise (e.g., 49900 = Rs 499)
  currency:         { type: String, default: 'INR' },
  gateway:          { type: String, enum: ['cashfree', 'manual', 'none'], default: 'none' },
  gatewayOrderId:   { type: String, default: null, index: true },
  gatewayPaymentId: { type: String, default: null },
  startedAt:        { type: Date, default: Date.now },
  expiresAt:        { type: Date, default: null },
  cancelledAt:      { type: Date, default: null },
}, { timestamps: true });

const Subscription = mongoose.model('Subscription', subscriptionSchema);

// ── Chat Usage schema ─────────────────────────────────────────────────────────
const chatUsageSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  yearMonth: { type: String, required: true, index: true }, // 'YYYY-MM'
  count:     { type: Number, default: 0 },
}, { timestamps: true });
chatUsageSchema.index({ userId: 1, yearMonth: 1 }, { unique: true });

const ChatUsage = mongoose.model('ChatUsage', chatUsageSchema);

module.exports = { connectDB, User, Review, Notification, AuditLog, Subscription, ChatUsage };

