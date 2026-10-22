/**
 * In-memory sliding window rate limiter for CodeSense auth endpoints
 */

const loginAttempts = new Map();     // ip -> [timestamps]
const registerAttempts = new Map();  // ip -> [timestamps]
const resendAttempts = new Map();    // email -> [timestamps]

// Clean up expired timestamps periodically (unref timer so it does not prevent process exit in tests/scripts)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  const fifteenMinsAgo = now - 15 * 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;

  for (const [ip, times] of loginAttempts) {
    const valid = times.filter(t => t > fifteenMinsAgo);
    if (valid.length === 0) loginAttempts.delete(ip);
    else loginAttempts.set(ip, valid);
  }

  for (const [ip, times] of registerAttempts) {
    const valid = times.filter(t => t > fifteenMinsAgo);
    if (valid.length === 0) registerAttempts.delete(ip);
    else registerAttempts.set(ip, valid);
  }

  for (const [email, times] of resendAttempts) {
    const valid = times.filter(t => t > oneHourAgo);
    if (valid.length === 0) resendAttempts.delete(email);
    else resendAttempts.set(email, valid);
  }
}, 10 * 60 * 1000);
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Check and record login attempt
 * Limit: 10 attempts per 15 minutes
 */
function checkLoginLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 10;

  const history = (loginAttempts.get(ip) || []).filter(t => t > now - windowMs);
  if (history.length >= maxAttempts) {
    const oldest = history[0];
    const waitSec = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, waitSec, message: 'Too many login attempts. Please wait before trying again.' };
  }
  history.push(now);
  loginAttempts.set(ip, history);
  return { allowed: true };
}

/**
 * Check and record registration attempt
 * Limit: 10 registrations per 15 minutes per IP
 */
function checkRegisterLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 10;

  const history = (registerAttempts.get(ip) || []).filter(t => t > now - windowMs);
  if (history.length >= maxAttempts) {
    const oldest = history[0];
    const waitSec = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, waitSec, message: 'Too many registration attempts. Please wait before trying again.' };
  }
  history.push(now);
  registerAttempts.set(ip, history);
  return { allowed: true };
}

/**
 * Check resend code rate limit
 * Cooldown: 30 seconds
 * Limit: 5 per hour
 */
function checkResendLimit(email) {
  const key = email.toLowerCase().trim();
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const cooldownMs = 30 * 1000;
  const maxPerHour = 5;

  const history = (resendAttempts.get(key) || []).filter(t => t > now - hourMs);
  
  // Cooldown check
  if (history.length > 0) {
    const lastAttempt = history[history.length - 1];
    if (now - lastAttempt < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - (now - lastAttempt)) / 1000);
      return { allowed: false, waitSec, message: `Resend available in ${waitSec} seconds` };
    }
  }

  // Hourly limit check
  if (history.length >= maxPerHour) {
    const oldest = history[0];
    const waitMin = Math.ceil((oldest + hourMs - now) / (60 * 1000));
    return { allowed: false, waitMin, message: `Too many verification code requests. Please wait ${waitMin} minutes before requesting another code.` };
  }

  history.push(now);
  resendAttempts.set(key, history);
  return { allowed: true };
}

module.exports = {
  getClientIp,
  checkLoginLimit,
  checkRegisterLimit,
  checkResendLimit,
};
