require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const http   = require('http');
const { spawn, exec } = require('child_process');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { connectDB, User, Review, Notification, AuditLog, Subscription, ChatUsage } = require('./db');
const {
  ROLES,
  PERMISSIONS,
  normalizeRole,
  hasPermission,
  canManageTargetAccount,
  canAssignRole,
} = require('./rbac');
const {
  PLANS,
  normalizePlan,
  getCashfreeConfig,
  verifyCashfreeWebhookSignature,
  createCashfreePaymentLink,
  fetchCashfreeOrderStatus,
  getUserActiveSubscription,
  getUserUsageStats,
  checkReviewQuota,
  checkChatQuota,
  recordChatUsage,
  activateSubscription,
  cancelSubscription,
} = require('./membership');
const { isConfigured: isEmailConfigured, sendVerificationEmail, sendNotificationEmail } = require('./email');
const { getClientIp, checkLoginLimit, checkRegisterLimit, checkResendLimit } = require('./rateLimiter');
const mongoose = require('mongoose');

const VENV_PYTHON      = path.resolve(__dirname, '..', '.venv', 'Scripts', 'python.exe');
const PYTHON_BIN       = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python';
const GENERATOR_SCRIPT = path.resolve(__dirname, 'generate_review_doc.py');
const PORT             = Number(process.env.PORT || 4000);

// ── JWT Secret Validation & Resolution (P1 Security Hardening) ─────────────
function resolveJwtSecret() {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret === 'codesense-jwt-secret' || secret.length < 16) {
      console.error('[SECURITY ERROR] Fatal: JWT_SECRET must be set to a secure, random string (min 16 chars) in production.');
      process.exit(1);
    }
    return secret;
  }
  // In development/test environments:
  if (!secret) {
    const fallback = crypto.randomBytes(32).toString('hex');
    console.warn('[SECURITY WARNING] No JWT_SECRET set in environment. Generated ephemeral secret for this session.');
    return fallback;
  }
  return secret;
}
const JWT_SECRET       = resolveJwtSecret();
const ADMIN_EMAIL      = (process.env.ADMIN_EMAIL || 'admin@codesense.dev').toLowerCase();

// ── Frontend & Google OAuth 2.0 Configuration ─────────────────────────────────
const GOOGLE_CLIENT_ID     = (process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

function sanitizeUrlEnv(val) {
  if (!val || typeof val !== 'string') return '';
  let cleaned = val.trim().replace(/^['"]+|['"]+$/g, '');
  // If accidentally entered as "KEY = https://..." or "KEY=https://..."
  const prefixMatch = cleaned.match(/^[A-Za-z0-9_]+\s*=\s*(https?:\/\/.*)$/i);
  if (prefixMatch) {
    cleaned = prefixMatch[1].trim();
  }
  return cleaned.replace(/^['"]+|['"]+$/g, '').trim();
}

function resolveFrontendUrl(req) {
  // 1. If request came through a reverse proxy (e.g. Vercel rewrite or custom domain)
  if (req && req.headers) {
    const fHost = req.headers['x-forwarded-host'];
    if (fHost) {
      const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const host = fHost.split(',')[0].trim();
      if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        return `${proto}://${host}`;
      }
    }

    const origin = req.headers.origin;
    if (origin && origin !== 'null' && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
      return origin.replace(/\/+$/, '');
    }

    const referer = req.headers.referer;
    if (referer) {
      try {
        const u = new URL(referer);
        if (u.host && !u.host.includes('localhost') && !u.host.includes('127.0.0.1')) {
          return `${u.protocol}//${u.host}`;
        }
      } catch (_) {}
    }
  }

  // 2. Explicit environment variable: FRONTEND_URL
  const envFrontend = sanitizeUrlEnv(process.env.FRONTEND_URL).replace(/\/+$/, '');
  if (envFrontend) {
    return envFrontend;
  }

  // 3. Fallback for local development
  return 'http://localhost:5173';
}

function getGoogleRedirectUri(req) {
  const explicitUri = sanitizeUrlEnv(process.env.GOOGLE_REDIRECT_URI);
  // If explicitly configured to a non-localhost URI, respect it
  if (explicitUri && !explicitUri.includes('localhost') && !explicitUri.includes('127.0.0.1')) {
    return explicitUri;
  }

  // If request originates from a remote frontend (e.g. Vercel), route callback through it
  const frontend = resolveFrontendUrl(req);
  if (frontend && !frontend.includes('localhost') && !frontend.includes('127.0.0.1')) {
    return `${frontend}/api/auth/google/callback`;
  }

  // If explicit URI is set (e.g. localhost during local dev), use it
  if (explicitUri) {
    return explicitUri;
  }

  return `${frontend}/api/auth/google/callback`;
}


// ── In-memory job store ───────────────────────────────────────────────────────
const jobs = new Map();
function cleanOldJobs() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.startedAt < cutoff) jobs.delete(id);
}
const cleanOldJobsTimer = setInterval(cleanOldJobs, 30 * 60 * 1000);
if (cleanOldJobsTimer.unref) {
  cleanOldJobsTimer.unref();
}

// ── Cookie & Session Helpers ──────────────────────────────────────────────────
function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts.shift().trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

function setSessionCookie(res, token, req) {
  const isHttps = req?.headers?.['x-forwarded-proto'] === 'https';
  const isProd = process.env.NODE_ENV === 'production' || isHttps;
  // Non-persistent Session Cookie: omits Max-Age and Expires so browser deletes it when session closes
  res._cookieHeader = `codesense_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`;
}

function clearSessionCookie(res, req) {
  const isHttps = req?.headers?.['x-forwarded-proto'] === 'https';
  const isProd = process.env.NODE_ENV === 'production' || isHttps;
  res._cookieHeader = `codesense_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}`;
}

// ── OTP Helpers ───────────────────────────────────────────────────────────────
function generateOtp() {
  // 6-digit numeric cryptographic random PIN
  return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(code) {
  return crypto.createHmac('sha256', JWT_SECRET).update(code.toString().trim()).digest('hex');
}

function verifyOtp(submittedCode, storedHash) {
  if (!submittedCode || !storedHash) return false;
  try {
    const computed = hashOtp(submittedCode);
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function sendJson(res, code, payload, extraHeaders = {}) {
  const origin = res._req?.headers?.origin;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
    ...extraHeaders,
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  if (res._cookieHeader) {
    headers['Set-Cookie'] = res._cookieHeader;
  }
  res.writeHead(code, headers);
  res.end(JSON.stringify(payload));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c.toString(); });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c.toString(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

async function logAuditEvent({ action, req = null, actor = null, target = null, details = {}, outcome = 'SUCCESS' }) {
  try {
    const ip = req ? getClientIp(req) : null;
    await AuditLog.create({
      action,
      actorId: actor?.id || actor?._id || null,
      actorEmail: actor?.email || null,
      actorRole: actor?.role || null,
      targetId: target?.id || target?._id || null,
      targetEmail: target?.email || null,
      details,
      outcome,
      ip,
    });
  } catch (err) {
    console.error('[audit log error]', err.message);
  }
}

function signToken(user) {
  return jwt.sign({
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion || 0,
  }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(req) {
  // 1. Authorization Bearer header
  const h = req.headers['authorization'] || '';
  let t = h.startsWith('Bearer ') ? h.slice(7).trim() : null;

  // 2. Session cookie fallback
  if (!t) {
    const cookies = parseCookies(req);
    t = cookies['codesense_session'] || null;
  }

  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}

async function requireAuth(req, res) {
  const payload = verifyToken(req);
  if (!payload) {
    sendJson(res, 401, { ok: false, error: 'Unauthorised' });
    return null;
  }

  try {
    const user = await User.findById(payload.id);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Account not found' });
      return null;
    }

    if (user.status === 'SUSPENDED') {
      sendJson(res, 403, {
        ok: false,
        error: 'Account is suspended. Please contact platform administration.',
        code: 'ACCOUNT_SUSPENDED',
      });
      return null;
    }

    if (typeof user.tokenVersion === 'number' && typeof payload.tokenVersion === 'number') {
      if (user.tokenVersion !== payload.tokenVersion) {
        sendJson(res, 401, {
          ok: false,
          error: 'Session invalidated due to security changes. Please sign in again.',
          code: 'SESSION_REVOKED',
        });
        return null;
      }
    }

    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status || 'ACTIVE',
      dbUser: user,
    };
  } catch (err) {
    console.error('[requireAuth db error]', err.message);
    sendJson(res, 500, { ok: false, error: 'Authentication verification failed' });
    return null;
  }
}

async function requirePermission(req, res, permission) {
  const auth = await requireAuth(req, res);
  if (!auth) return null;

  if (!hasPermission(auth.role, permission)) {
    await logAuditEvent({
      action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      req,
      actor: auth,
      details: { requiredPermission: permission, userRole: auth.role },
      outcome: 'FAILURE',
    });
    sendJson(res, 403, { ok: false, error: 'Forbidden: Insufficient privileges' });
    return null;
  }

  return auth;
}

async function requireAdmin(req, res) {
  return await requirePermission(req, res, PERMISSIONS.ADMIN_ACCESS);
}

function safeUser(u) {
  return {
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    role: u.role,
    membershipPlan: u.membershipPlan || 'FREE',
    status: u.status || 'ACTIVE',
    emailVerified: u.emailVerified !== false,
    authProvider: u.authProvider || 'local',
    avatar: u.avatar || null,
    bio: u.bio || '',
    notificationPreferences: u.notificationPreferences || {
      analysisCompleted: true,
      criticalIssues: true,
      securityAlerts: true,
      emailNotifications: true,
    },
    created_at: u.createdAt,
  };
}

const STORAGE_TEMP = path.resolve(__dirname, '..', 'storage', 'temp');
if (!fs.existsSync(STORAGE_TEMP)) fs.mkdirSync(STORAGE_TEMP, { recursive: true });

// ── Repo resolver ─────────────────────────────────────────────────────────────
function resolveRepoPath(input, callback) {
  const t = (input || '').trim();
  if (!t) { callback(null, path.resolve(__dirname, '..'), null); return; }
  if (/^https?:\/\//i.test(t) || /^git@/i.test(t) || /^ssh:\/\//i.test(t)) {
    const workDir   = fs.mkdtempSync(path.join(STORAGE_TEMP, 'codesense-review-'));
    const targetDir = path.join(workDir, 'repo');
    const child = spawn('git', ['clone', '--depth=1', t, targetDir], { shell: false, stdio: ['ignore','pipe','pipe'] });
    let stderr = '';
    child.stderr.on('data', c => { stderr += c.toString(); });
    child.on('error', e => callback(`${stderr}\n${e.message}`, null, workDir));
    child.on('close', code => {
      if (code !== 0) { callback(stderr || `Git clone failed (${code})`, null, workDir); return; }
      callback(null, targetDir, workDir);
    });
    return;
  }
  callback(null, t, null);
}

// ── Notification Dispatcher (DB + Email) ──────────────────────────────────────
async function dispatchNotification({ userId, title, message, type, repo, reviewId, link, buttonText }) {
  if (!userId) return;
  const directLink = link || (reviewId ? `/?reviewId=${reviewId}` : (type === 'subscription' ? '/settings/profile' : '/history'));

  // Notification Deduplication Guard (2-minute window prevents duplicate emails on retries/webhooks)
  try {
    const recentDuplicate = await Notification.findOne({
      userId,
      title,
      createdAt: { $gt: new Date(Date.now() - 2 * 60 * 1000) },
    });
    if (recentDuplicate) {
      console.log(`[notification] Deduplicated duplicate notification for user ${userId}: "${title}"`);
      return;
    }
  } catch (dedupErr) {
    console.error('[notification dedup error]', dedupErr.message);
  }

  try {
    await Notification.create({
      userId,
      title,
      message,
      type,
      repo,
      reviewId,
      link: directLink,
    });
  } catch (err) {
    console.error('[notification db error]', err.message);
  }

  try {
    const u = await User.findById(userId);
    if (!u || !u.email) return;
    if (u.status === 'SUSPENDED') return;
    const prefs = u.notificationPreferences || {};
    if (prefs.emailNotifications === false) return;

    if (type === 'analysis_completed' && prefs.analysisCompleted === false) return;
    if (type === 'security_alert' && prefs.securityAlerts === false) return;
    if (type === 'critical_issues' && prefs.criticalIssues === false) return;

    await sendNotificationEmail({
      to: u.email,
      name: u.name,
      title,
      message,
      type,
      repo,
      link: directLink,
      buttonText,
    });
  } catch (err) {
    console.error('[notification email error]', err.message);
  }
}

// ── Job runner ────────────────────────────────────────────────────────────────
function startJob(jobId, repoInput, reviewId) {
  const job = { status: 'cloning', step: 0, total: 4, message: 'Cloning repository…', markdown: null, error: null, startedAt: Date.now(), reviewId };
  jobs.set(jobId, job);

  resolveRepoPath(repoInput, async (err, repoPath, workDir) => {
    if (err) {
      if (workDir) { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {} }
      job.status = 'error'; job.error = err.toString().slice(0, 500);
      if (reviewId) {
        await Review.findByIdAndUpdate(reviewId, { status: 'error', error: job.error, finishedAt: new Date() });
        try {
          const rev = await Review.findById(reviewId);
          if (rev && rev.userId) {
            dispatchNotification({
              userId: rev.userId,
              title: 'Analysis Failed',
              message: `Review for ${rev.repo} failed during cloning: ${job.error.slice(0, 100)}`,
              type: 'critical_issues',
              repo: rev.repo,
              reviewId: rev._id,
            });
          }
        } catch (_) {}
      }
      return;
    }
    job.status = 'running'; job.message = 'Reading source files…';

    const outFile      = path.join(STORAGE_TEMP, `codesense-out-${jobId}.json`);
    const progressFile = path.join(STORAGE_TEMP, `codesense-progress-${jobId}.txt`);

    const envConfig = require('dotenv').config({ path: path.resolve(__dirname, '.env'), override: true }).parsed || {};
    const child = spawn(PYTHON_BIN, [GENERATOR_SCRIPT, repoPath, repoInput || 'local', outFile, progressFile], {
      cwd: path.resolve(__dirname, '..'),
      shell: false,
      env: { ...process.env, ...envConfig },
    });

    const progressInterval = setInterval(() => {
      try {
        if (fs.existsSync(progressFile)) {
          const last = fs.readFileSync(progressFile, 'utf-8').trim().split('\n').pop().trim();
          if (last) {
            const m = last.match(/^STEP:(\d+):(\d+):(.+)$/);
            if (m) { job.step = parseInt(m[1]); job.total = parseInt(m[2]); job.message = m[3]; }
            else   { job.message = last; }
          }
        }
      } catch (_) {}
    }, 2000);

    child.on('error', async spawnErr => {
      clearInterval(progressInterval);
      job.status = 'error'; job.error = spawnErr.message;
      if (reviewId) {
        await Review.findByIdAndUpdate(reviewId, { status: 'error', error: job.error, finishedAt: new Date() });
        try {
          const rev = await Review.findById(reviewId);
          if (rev && rev.userId) {
            dispatchNotification({
              userId: rev.userId,
              title: 'Analysis Failed',
              message: `Process error for ${rev.repo}: ${job.error.slice(0, 100)}`,
              type: 'critical_issues',
              repo: rev.repo,
              reviewId: rev._id,
            });
          }
        } catch (_) {}
      }
    });

    child.on('close', async code => {
      clearInterval(progressInterval);
      try { if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile); } catch (_) {}
      if (workDir) { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {} }
      const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
      try {
        const raw    = fs.readFileSync(outFile, 'utf-8');
        try { fs.unlinkSync(outFile); } catch (_) {}
        const result = JSON.parse(raw);
        if (result.ok) {
          job.status = 'done'; job.step = job.total; job.message = 'Complete!'; job.markdown = result.markdown;
          if (reviewId) {
            await Review.findByIdAndUpdate(reviewId, { status: 'done', elapsedSec: elapsed, markdown: result.markdown, finishedAt: new Date() });
            try {
              const rev = await Review.findById(reviewId);
              if (rev && rev.userId) {
                const u = await User.findById(rev.userId);
                const prefs = u?.notificationPreferences || {};
                if (prefs.analysisCompleted !== false) {
                  dispatchNotification({
                    userId: rev.userId,
                    title: 'Analysis Completed',
                    message: `Code review for ${rev.repo} (${rev.branch || 'main'}) finished in ${elapsed}s.`,
                    type: 'analysis_completed',
                    repo: rev.repo,
                    reviewId: rev._id,
                    link: `/?reviewId=${rev._id}`,
                  });
                }
                if (prefs.securityAlerts !== false && /security|vulnerability|cwe|cve/i.test(result.markdown || '')) {
                  dispatchNotification({
                    userId: rev.userId,
                    title: 'Security Alert',
                    message: `Security-related findings detected during review of ${rev.repo}.`,
                    type: 'security_alert',
                    repo: rev.repo,
                    reviewId: rev._id,
                    link: `/?reviewId=${rev._id}`,
                  });
                }
              }
            } catch (notifErr) {
              console.error('[notification error]', notifErr.message);
            }
          }
        } else {
          job.status = 'error'; job.error = result.error || 'Generator failed.';
          if (reviewId) {
            await Review.findByIdAndUpdate(reviewId, { status: 'error', elapsedSec: elapsed, error: job.error, finishedAt: new Date() });
            try {
              const rev = await Review.findById(reviewId);
              if (rev && rev.userId) {
                dispatchNotification({
                  userId: rev.userId,
                  title: 'Analysis Failed',
                  message: `Review for ${rev.repo} failed: ${(job.error || 'Unknown error').slice(0, 100)}`,
                  type: 'critical_issues',
                  repo: rev.repo,
                  reviewId: rev._id,
                  link: `/?reviewId=${rev._id}`,
                });
              }
            } catch (_) {}
          }
        }
      } catch (readErr) {
        job.status = 'error'; job.error = `Could not read output (exit ${code}): ${readErr.message}`;
        if (reviewId) {
          await Review.findByIdAndUpdate(reviewId, { status: 'error', elapsedSec: elapsed, error: job.error, finishedAt: new Date() });
          try {
            const rev = await Review.findById(reviewId);
            if (rev && rev.userId) {
              dispatchNotification({
                userId: rev.userId,
                title: 'Analysis Failed',
                message: `Review for ${rev.repo} could not be read: ${readErr.message.slice(0, 80)}`,
                type: 'critical_issues',
                repo: rev.repo,
                reviewId: rev._id,
                link: `/?reviewId=${rev._id}`,
              });
            }
          } catch (_) {}
        }
      }
    });
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res._req = req; // Preserve request for CORS origin & cookie handling
  if (req.method === 'OPTIONS') { sendJson(res, 204, {}); return; }
  const url = req.url.split('?')[0];

  try {
    // Health — always returns, shows DB status
    if (req.method === 'GET' && url === '/api/health') {
      const dbState = mongoose.connection.readyState; // 0=disconnected,1=connected,2=connecting
      const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';
      sendJson(res, 200, { status: 'ok', db: dbStatus }); return;
    }

    // DB connectivity guard for routes that need it
    if (mongoose.connection.readyState !== 1) {
      const isAuthOrData = ['/api/auth/', '/api/history', '/api/admin', '/api/membership'].some(p => url.startsWith(p));
      if (isAuthOrData) {
        sendJson(res, 503, { ok: false, error: 'Database connecting — please try again in a few seconds' }); return;
      }
    }

    // ── Auth: Register (Step 1: Validate & Send Verification OTP) ──────────────
    if (req.method === 'POST' && url === '/api/auth/register') {
      const ip = getClientIp(req);
      const regLimit = checkRegisterLimit(ip);
      if (!regLimit.allowed) {
        sendJson(res, 429, { ok: false, error: regLimit.message });
        return;
      }

      const { email, password, name } = await readBody(req);
      if (!email || !password || !name) {
        sendJson(res, 400, { ok: false, error: 'Name, email, and password are required' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanName = name.trim();

      // Email format validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        sendJson(res, 400, { ok: false, error: 'Please enter a valid email address' });
        return;
      }

      // Password requirement: at least 6 characters
      if (password.length < 6) {
        sendJson(res, 400, { ok: false, error: 'Password must be at least 6 characters' });
        return;
      }

      const existing = await User.findOne({ email: cleanEmail });
      // If account already exists and is fully verified
      if (existing && existing.emailVerified !== false) {
        sendJson(res, 409, { ok: false, error: 'An account with this email already exists. Try signing in.' });
        return;
      }

      // Generate secure 6-digit PIN
      const pin = generateOtp();
      const pinHash = hashOtp(pin);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
      const resendAvailableAt = new Date(Date.now() + 30 * 1000); // 30 seconds cooldown

      // Send the PIN to the user's email
      try {
        await sendVerificationEmail({ to: cleanEmail, name: cleanName, code: pin });
      } catch (emailErr) {
        console.error('[register email error]', emailErr.message);
        sendJson(res, 500, { ok: false, error: 'Unable to send the verification email. Please try again.' });
        return;
      }

      const hashedPassword = bcrypt.hashSync(password, 10);

      if (existing && existing.emailVerified === false) {
        // Update pending unverified registration with new credentials & fresh code
        existing.name = cleanName;
        existing.password = hashedPassword;
        existing.role = ROLES.USER;
        existing.status = 'ACTIVE';
        existing.verificationCodeHash = pinHash;
        existing.verificationCodeExpiresAt = expiresAt;
        existing.verificationAttempts = 0;
        existing.verificationResendAvailableAt = resendAvailableAt;
        await existing.save();
      } else {
        // Create pending registration (unverified)
        await User.create({
          email: cleanEmail,
          name: cleanName,
          password: hashedPassword,
          role: ROLES.USER,
          status: 'ACTIVE',
          tokenVersion: 0,
          emailVerified: false,
          authProvider: 'local',
          verificationCodeHash: pinHash,
          verificationCodeExpiresAt: expiresAt,
          verificationAttempts: 0,
          verificationResendAvailableAt: resendAvailableAt,
        });
      }

      sendJson(res, 201, {
        ok: true,
        message: 'Verification code sent to your email',
        email: cleanEmail,
        resendAvailableIn: 30,
        expiresIn: 600,
      });
      return;
    }

    // ── Auth: Verify Email OTP (Step 2: Activate & Create Session) ─────────────
    if (req.method === 'POST' && url === '/api/auth/verify-email') {
      const { email, code } = await readBody(req);
      if (!email || !code) {
        sendJson(res, 400, { ok: false, error: 'Email and verification code are required' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanCode = code.toString().trim();

      if (!/^\d{6}$/.test(cleanCode)) {
        sendJson(res, 400, { ok: false, error: 'Verification code must be 6 digits' });
        return;
      }

      const user = await User.findOne({ email: cleanEmail });
      if (!user) {
        sendJson(res, 404, { ok: false, error: 'Invalid registration session. Please register again.' });
        return;
      }

      if (user.emailVerified === true) {
        // Already active
        const token = signToken(user);
        setSessionCookie(res, token);
        sendJson(res, 200, { ok: true, alreadyVerified: true, user: safeUser(user), token });
        return;
      }

      // Check max failed attempts (max 5)
      if ((user.verificationAttempts || 0) >= 5) {
        sendJson(res, 429, { ok: false, error: 'Too many attempts. Please request a new verification code.', attemptsExceeded: true });
        return;
      }

      // Check code expiration (10 minutes)
      if (!user.verificationCodeExpiresAt || user.verificationCodeExpiresAt < new Date()) {
        sendJson(res, 400, { ok: false, error: 'This verification code has expired. Request a new code.', expired: true });
        return;
      }

      // Verify cryptographic OTP hash
      const isValid = verifyOtp(cleanCode, user.verificationCodeHash);
      if (!isValid) {
        user.verificationAttempts = (user.verificationAttempts || 0) + 1;
        await user.save();
        const remaining = 5 - user.verificationAttempts;
        if (remaining <= 0) {
          user.verificationCodeHash = null; // Invalidate after 5 failed tries
          await user.save();
          sendJson(res, 400, { ok: false, error: 'Too many failed attempts. This code has been invalidated. Please request a new code.', attemptsExceeded: true });
          return;
        }
        sendJson(res, 400, { ok: false, error: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
        return;
      }

      // Successful verification! Activate account & wipe OTP credentials
      user.emailVerified = true;
      user.verificationCodeHash = null;
      user.verificationCodeExpiresAt = null;
      user.verificationAttempts = 0;
      user.verificationResendAvailableAt = null;
      await user.save();

      // Issue authenticated browser session
      const token = signToken(user);
      setSessionCookie(res, token);
      sendJson(res, 200, { ok: true, message: 'Email verified successfully', user: safeUser(user), token });
      return;
    }

    // ── Auth: Resend Verification Code ─────────────────────────────────────────
    if (req.method === 'POST' && url === '/api/auth/resend-code') {
      const { email } = await readBody(req);
      if (!email) {
        sendJson(res, 400, { ok: false, error: 'Email is required' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const resendLimit = checkResendLimit(cleanEmail);
      if (!resendLimit.allowed) {
        sendJson(res, 429, { ok: false, error: resendLimit.message, waitSec: resendLimit.waitSec || 30 });
        return;
      }

      const user = await User.findOne({ email: cleanEmail });
      if (!user) {
        sendJson(res, 404, { ok: false, error: 'Registration session not found. Please register first.' });
        return;
      }

      if (user.emailVerified === true) {
        sendJson(res, 400, { ok: false, error: 'Email is already verified. Please sign in.' });
        return;
      }

      // Check model cooldown
      if (user.verificationResendAvailableAt && user.verificationResendAvailableAt > new Date()) {
        const waitSec = Math.ceil((user.verificationResendAvailableAt.getTime() - Date.now()) / 1000);
        sendJson(res, 429, { ok: false, error: `Resend available in ${waitSec} seconds`, waitSec });
        return;
      }

      // Generate new 6-digit PIN and invalidate previous code
      const pin = generateOtp();
      const pinHash = hashOtp(pin);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const resendAvailableAt = new Date(Date.now() + 30 * 1000);

      try {
        await sendVerificationEmail({ to: cleanEmail, name: user.name, code: pin });
      } catch (emailErr) {
        console.error('[resend email error]', emailErr.message);
        sendJson(res, 500, { ok: false, error: 'Unable to send the verification email. Please try again.' });
        return;
      }

      user.verificationCodeHash = pinHash;
      user.verificationCodeExpiresAt = expiresAt;
      user.verificationAttempts = 0;
      user.verificationResendAvailableAt = resendAvailableAt;
      await user.save();

      sendJson(res, 200, {
        ok: true,
        message: 'New verification code sent',
        resendAvailableIn: 30,
        expiresIn: 600,
      });
      return;
    }

    // ── Auth: Login ────────────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/api/auth/login') {
      const ip = getClientIp(req);
      const loginLimit = checkLoginLimit(ip);
      if (!loginLimit.allowed) {
        sendJson(res, 429, { ok: false, error: loginLimit.message });
        return;
      }

      const { email, password } = await readBody(req);
      if (!email || !password) {
        sendJson(res, 400, { ok: false, error: 'Email and password required' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const user = await User.findOne({ email: cleanEmail });

      if (!user) {
        sendJson(res, 401, { ok: false, error: 'Email or password is incorrect.' });
        return;
      }

      // Google-only account without local password
      if (!user.password) {
        sendJson(res, 400, {
          ok: false,
          error: 'This account was created with Google. Please use "Continue with Google" to sign in.',
        });
        return;
      }

      if (!bcrypt.compareSync(password, user.password)) {
        sendJson(res, 401, { ok: false, error: 'Email or password is incorrect.' });
        return;
      }

      if (user.status === 'SUSPENDED') {
        await logAuditEvent({
          action: 'SUSPENDED_LOGIN_ATTEMPT',
          req,
          actor: { id: user._id, email: user.email, role: user.role },
          details: { reason: 'Account suspended' },
          outcome: 'FAILURE',
        });
        sendJson(res, 403, { ok: false, error: 'This account has been suspended. Please contact platform administration.' });
        return;
      }

      // Verification code is only required when registering a new account.
      // If a user signs in with valid password, authenticate directly without blocking.
      if (user.emailVerified === false) {
        user.emailVerified = true;
        await user.save();
      }

      // Issue authenticated browser session
      const token = signToken(user);
      setSessionCookie(res, token);
      sendJson(res, 200, { ok: true, token, user: safeUser(user) });
      return;
    }

    // ── Auth: Logout ───────────────────────────────────────────────────────────
    if (req.method === 'POST' && url === '/api/auth/logout') {
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true, message: 'Logged out successfully' });
      return;
    }

    // ── Auth: Get Current User (Session / Me) ──────────────────────────────────
    if (req.method === 'GET' && url === '/api/auth/me') {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const user = await User.findById(auth.id);
      if (!user) { sendJson(res, 404, { ok: false, error: 'User not found' }); return; }
      const token = signToken(user);
      sendJson(res, 200, { ok: true, user: safeUser(user), token });
      return;
    }

    // ── Auth: Google OAuth Status Check ───────────────────────────────────────
    if (req.method === 'GET' && url === '/api/auth/google/status') {
      sendJson(res, 200, {
        ok: true,
        configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
        clientId: GOOGLE_CLIENT_ID || null,
      });
      return;
    }

    // ── Auth: Google OAuth Redirect (Start Flow) ──────────────────────────────
    if (req.method === 'GET' && url === '/api/auth/google') {
      const frontendUrl = resolveFrontendUrl(req);
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        const errorMsg = 'Google sign-in is not configured on the server. Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.';
        res.writeHead(302, { Location: `${frontendUrl}/login?error=${encodeURIComponent(errorMsg)}` });
        res.end();
        return;
      }

      const redirectUri = getGoogleRedirectUri(req);
      const statePayload = {
        nonce: crypto.randomBytes(12).toString('hex'),
        redirectUri,
        frontendUrl,
      };
      const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

      const isProd = process.env.NODE_ENV === 'production' || !frontendUrl.includes('localhost');
      res.setHeader('Set-Cookie', `codesense_oauth_state=${statePayload.nonce}; Path=/; HttpOnly; SameSite=Lax${isProd ? '; Secure' : ''}; Max-Age=600`);

      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid email profile',
          access_type: 'online',
          prompt: 'select_account',
          state,
        }).toString();

      res.writeHead(302, { Location: googleAuthUrl });
      res.end();
      return;
    }

    // ── Auth: Google OAuth Callback ───────────────────────────────────────────
    if (req.method === 'GET' && url === '/api/auth/google/callback') {
      const fullUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const code = fullUrl.searchParams.get('code');
      const errorParam = fullUrl.searchParams.get('error');
      const stateParam = fullUrl.searchParams.get('state');

      let redirectUriUsed = getGoogleRedirectUri(req);
      let returnFrontend = resolveFrontendUrl(req);

      if (stateParam) {
        try {
          const parsed = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
          if (parsed && typeof parsed === 'object') {
            if (parsed.redirectUri) redirectUriUsed = parsed.redirectUri;
            if (parsed.frontendUrl) returnFrontend = parsed.frontendUrl.replace(/\/+$/, '');
          }
        } catch (_) {}
      }

      if (errorParam) {
        res.writeHead(302, { Location: `${returnFrontend}/login?error=${encodeURIComponent('Google sign-in could not be completed: ' + errorParam)}` });
        res.end();
        return;
      }

      if (!code) {
        res.writeHead(302, { Location: `${returnFrontend}/login?error=${encodeURIComponent('Google sign-in failed: No authorization code received.')}` });
        res.end();
        return;
      }

      try {
        // Exchange code with Google
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUriUsed,
            grant_type: 'authorization_code',
          }),
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
          const errMsg = tokenData.error_description || tokenData.error || 'Failed to exchange Google authorization code';
          res.writeHead(302, { Location: `${returnFrontend}/login?error=${encodeURIComponent('Google sign-in failed: ' + errMsg)}` });
          res.end();
          return;
        }

        // Fetch verified user profile from Google OpenID Connect userinfo
        const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const googleUser = await profileRes.json();

        if (!googleUser.email) {
          res.writeHead(302, { Location: `${returnFrontend}/login?error=${encodeURIComponent('Google account did not provide an email address.')}` });
          res.end();
          return;
        }

        const email = googleUser.email.toLowerCase().trim();
        const name = googleUser.name || googleUser.given_name || email.split('@')[0];
        const googleId = googleUser.sub;
        const avatar = googleUser.picture || null;

        // Account lookup and safe linking
        let user = await User.findOne({ email });
        if (user) {
          if (user.status === 'SUSPENDED') {
            await logAuditEvent({
              action: 'SUSPENDED_LOGIN_ATTEMPT',
              actor: { id: user._id, email: user.email, role: user.role },
              details: { provider: 'google_oauth' },
              outcome: 'FAILURE',
            });
            res.writeHead(302, { Location: `${returnFrontend}/login?error=${encodeURIComponent('This account has been suspended. Please contact platform administration.')}` });
            res.end();
            return;
          }
          // Existing account: Link Google identity safely without modifying existing role or password
          user.googleId = googleId;
          user.emailVerified = true;
          if (avatar && !user.avatar) user.avatar = avatar;
          if (!user.name && name) user.name = name;
          await user.save();
        } else {
          // New account: Default to safe ROLES.USER
          user = await User.create({
            email,
            name,
            role: ROLES.USER,
            status: 'ACTIVE',
            tokenVersion: 0,
            emailVerified: true,
            authProvider: 'google',
            googleId,
            avatar,
          });
        }

        const token = signToken(user);
        setSessionCookie(res, token, req);
        res.writeHead(302, {
          Location: `${returnFrontend}/?auth=google_success`,
          'Set-Cookie': res._cookieHeader,
        });
        res.end();
        return;
      } catch (err) {
        console.error('[google callback error]', err);
        res.writeHead(302, { Location: `${returnFrontend}/login?error=${encodeURIComponent('Google sign-in could not be completed. Please try again.')}` });
        res.end();
        return;
      }
    }

    // ── Auth: Google Credential / ID Token Direct Verification ────────────────
    if (req.method === 'POST' && url === '/api/auth/google') {
      const { credential } = await readBody(req);
      if (!credential) {
        sendJson(res, 400, { ok: false, error: 'Google credential is required' });
        return;
      }

      try {
        const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
        const tokenInfo = await verifyRes.json();

        if (!verifyRes.ok || !tokenInfo.email) {
          sendJson(res, 401, { ok: false, error: 'Invalid Google credential token' });
          return;
        }

        const email = tokenInfo.email.toLowerCase().trim();
        const name = tokenInfo.name || email.split('@')[0];
        const googleId = tokenInfo.sub;
        const avatar = tokenInfo.picture || null;

        let user = await User.findOne({ email });
        if (user) {
          if (user.status === 'SUSPENDED') {
            sendJson(res, 403, { ok: false, error: 'This account has been suspended. Please contact platform administration.' });
            return;
          }
          user.googleId = googleId;
          user.emailVerified = true;
          if (avatar && !user.avatar) user.avatar = avatar;
          await user.save();
        } else {
          user = await User.create({
            email,
            name,
            role: ROLES.USER,
            status: 'ACTIVE',
            tokenVersion: 0,
            emailVerified: true,
            authProvider: 'google',
            googleId,
            avatar,
          });
        }

        const token = signToken(user);
        setSessionCookie(res, token);
        sendJson(res, 200, { ok: true, user: safeUser(user), token });
        return;
      } catch (err) {
        console.error('[google id_token error]', err);
        sendJson(res, 500, { ok: false, error: 'Google sign-in could not be completed. Please try again.' });
        return;
      }
    }

    // ── User Profile: Update Name, Bio, Avatar ────────────────────────────────
    if (req.method === 'PUT' && url === '/api/user/profile') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const body = await readBody(req);
      const name = (body.name || '').trim();
      const bio = typeof body.bio === 'string' ? body.bio.trim() : '';
      const avatar = body.avatar;

      if (!name) {
        sendJson(res, 400, { ok: false, error: 'Full name is required' });
        return;
      }
      if (name.length > 100) {
        sendJson(res, 400, { ok: false, error: 'Full name must be under 100 characters' });
        return;
      }
      if (bio.length > 500) {
        sendJson(res, 400, { ok: false, error: 'Bio must be under 500 characters' });
        return;
      }

      const updateFields = { name, bio };

      if (avatar === null || avatar === '') {
        updateFields.avatar = null;
      } else if (typeof avatar === 'string') {
        // Enforce max size ~2MB base64/URL
        if (avatar.length > 3 * 1024 * 1024) {
          sendJson(res, 400, { ok: false, error: 'Avatar image is too large (max 2MB)' });
          return;
        }
        updateFields.avatar = avatar;
      }

      const updatedUser = await User.findByIdAndUpdate(auth.id, updateFields, { new: true });
      if (!updatedUser) {
        sendJson(res, 404, { ok: false, error: 'User not found' });
        return;
      }

      sendJson(res, 200, { ok: true, user: safeUser(updatedUser) });
      return;
    }

    // ── User Settings: Notification Preferences ───────────────────────────────
    if (req.method === 'PUT' && url === '/api/user/preferences') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const body = await readBody(req);
      const prefs = body.notificationPreferences;
      if (!prefs || typeof prefs !== 'object') {
        sendJson(res, 400, { ok: false, error: 'notificationPreferences object is required' });
        return;
      }

      const user = await User.findById(auth.id);
      if (!user) {
        sendJson(res, 404, { ok: false, error: 'User not found' });
        return;
      }

      const current = user.notificationPreferences ? (user.notificationPreferences.toObject ? user.notificationPreferences.toObject() : user.notificationPreferences) : {};
      const allowed = ['analysisCompleted', 'criticalIssues', 'securityAlerts', 'emailNotifications'];
      for (const k of allowed) {
        if (typeof prefs[k] === 'boolean') {
          current[k] = prefs[k];
        }
      }

      user.notificationPreferences = current;
      await user.save();

      sendJson(res, 200, { ok: true, user: safeUser(user) });
      return;
    }

    // ── User Settings: Send Test Notification Email ───────────────────────────
    if (req.method === 'POST' && url === '/api/user/test-notification-email') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const user = await User.findById(auth.id);
      if (!user) {
        sendJson(res, 404, { ok: false, error: 'User not found' });
        return;
      }

      if (!user.email) {
        sendJson(res, 400, { ok: false, error: 'User does not have a registered email address' });
        return;
      }

      try {
        const result = await sendNotificationEmail({
          to: user.email,
          name: user.name,
          title: 'Test Notification from CodeSense',
          message: 'This is a test notification confirming that email alerts are configured and delivering properly to your inbox.',
          type: 'analysis_completed',
          repo: 'codesense/test-pipeline',
          link: '/settings/profile',
        });

        if (result.ok) {
          await Notification.create({
            userId: user._id,
            title: 'Test Notification Delivered',
            message: `A test notification email was successfully sent to ${user.email}.`,
            type: 'analysis_completed',
            repo: 'codesense/test-pipeline',
            link: '/settings/profile',
          });

          sendJson(res, 200, {
            ok: true,
            message: `Test email sent to ${user.email}`,
            simulated: Boolean(result.simulated),
          });
        } else {
          sendJson(res, 500, { ok: false, error: result.error || 'Failed to send test notification email' });
        }
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message || 'Error sending test notification email' });
      }
      return;
    }

    // ── Danger Zone: Delete Account & Associated Data ─────────────────────────
    if (req.method === 'DELETE' && url === '/api/user/account') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const { confirmation } = await readBody(req);
      if (confirmation !== 'DELETE') {
        sendJson(res, 400, { ok: false, error: 'You must type DELETE to confirm account deletion' });
        return;
      }

      // Safeguard: The final active Super Admin cannot delete their account
      if (auth.role === ROLES.SUPER_ADMIN) {
        const superAdminCount = await User.countDocuments({ role: ROLES.SUPER_ADMIN, status: 'ACTIVE' });
        if (superAdminCount <= 1) {
          sendJson(res, 400, {
            ok: false,
            error: 'Cannot delete the final active Super Admin account. Transfer Super Admin privileges before deleting.',
          });
          return;
        }
      }

      // Delete authenticated user-owned reviews and notifications
      await Review.deleteMany({ userId: auth.id });
      await Notification.deleteMany({ userId: auth.id });
      await User.findByIdAndDelete(auth.id);

      await logAuditEvent({
        action: 'USER_SELF_DELETE',
        req,
        actor: auth,
        outcome: 'SUCCESS',
      });

      clearSessionCookie(res);
      sendJson(res, 200, { ok: true, message: 'Account and associated data deleted successfully' });
      return;
    }

    // ── Notifications: List User Notifications & Unread Count ─────────────────
    if (req.method === 'GET' && url === '/api/notifications') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const notifications = await Notification.find({ userId: auth.id })
        .sort({ createdAt: -1 })
        .limit(50);
      const unreadCount = await Notification.countDocuments({ userId: auth.id, read: false });

      sendJson(res, 200, {
        ok: true,
        notifications: notifications.map(n => ({
          id: n._id.toString(),
          title: n.title,
          message: n.message,
          type: n.type,
          read: n.read,
          link: n.link,
          repo: n.repo,
          reviewId: n.reviewId ? n.reviewId.toString() : null,
          created_at: n.createdAt,
        })),
        unreadCount,
      });
      return;
    }

    // ── Notifications: Mark All as Read ───────────────────────────────────────
    if (req.method === 'PUT' && url === '/api/notifications/read-all') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      await Notification.updateMany({ userId: auth.id, read: false }, { read: true });
      sendJson(res, 200, { ok: true });
      return;
    }

    // ── Notifications: Mark Single as Read ────────────────────────────────────
    const notifReadMatch = url.match(/^\/api\/notifications\/([a-f0-9]+)\/read$/);
    if (req.method === 'PUT' && notifReadMatch) {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const notif = await Notification.findOne({ _id: notifReadMatch[1], userId: auth.id });
      if (!notif) {
        sendJson(res, 404, { ok: false, error: 'Notification not found' });
        return;
      }
      notif.read = true;
      await notif.save();
      sendJson(res, 200, { ok: true });
      return;
    }

    // ── Notifications: Delete Single Notification ─────────────────────────────
    const notifDelMatch = url.match(/^\/api\/notifications\/([a-f0-9]+)$/);
    if (req.method === 'DELETE' && notifDelMatch) {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      await Notification.findOneAndDelete({ _id: notifDelMatch[1], userId: auth.id });
      sendJson(res, 200, { ok: true });
      return;
    }

    // ── Notifications: Clear All Notifications ────────────────────────────────
    if (req.method === 'DELETE' && url === '/api/notifications') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      await Notification.deleteMany({ userId: auth.id });
      sendJson(res, 200, { ok: true });
      return;
    }

    // ── Membership: Public Plans Directory ──────────────────────────────────
    if (req.method === 'GET' && url === '/api/membership/plans') {
      const config = getCashfreeConfig();
      sendJson(res, 200, {
        ok: true,
        plans: PLANS,
        gatewayConfigured: config.isConfigured,
      });
      return;
    }

    // ── Membership: Current User Plan & Usage ─────────────────────────────────
    if (req.method === 'GET' && url === '/api/membership/current') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const usage = await getUserUsageStats(auth.id, auth.role);
      const config = getCashfreeConfig();
      sendJson(res, 200, {
        ok: true,
        subscription: usage,
        gatewayConfigured: config.isConfigured,
      });
      return;
    }

    // ── Membership: Create Hosted Checkout Order ─────────────────────────────
    if (req.method === 'POST' && url === '/api/membership/create-order') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const body = await readBody(req);
      const planId = normalizePlan(body.plan);
      const billingInterval = body.billingInterval === 'yearly' ? 'yearly' : 'monthly';

      if (planId === 'FREE') {
        sendJson(res, 400, { ok: false, error: 'Free tier does not require payment.' });
        return;
      }

      const plan = PLANS[planId];
      if (!plan) {
        sendJson(res, 400, { ok: false, error: `Invalid plan specified: ${body.plan}` });
        return;
      }

      const config = getCashfreeConfig();
      if (!config.isConfigured) {
        sendJson(res, 400, {
          ok: false,
          gatewayConfigured: false,
          error: 'Cashfree payment gateway credentials are not configured in backend/.env (CASHFREE_APP_ID, CASHFREE_SECRET_KEY). For testing or demo evaluation, please assign plans via the Admin Panel or set valid sandbox credentials.',
        });
        return;
      }

      try {
        const order = await createCashfreePaymentLink({
          user: auth,
          planId,
          billingInterval,
          returnUrl: body.returnUrl,
          notifyUrl: body.notifyUrl,
        });

        // Record PENDING order
        await Subscription.create({
          userId: auth.id,
          plan: planId,
          status: 'PENDING',
          billingInterval,
          amount: order.amount,
          currency: order.currency,
          gateway: 'cashfree',
          gatewayOrderId: order.orderId,
          startedAt: new Date(),
          expiresAt: null,
        });

        sendJson(res, 200, {
          ok: true,
          orderId: order.orderId,
          paymentLink: order.paymentLink,
          amount: order.amount,
          currency: order.currency,
          plan: planId,
          billingInterval,
        });
      } catch (err) {
        console.error('[create-order error]', err.message);
        sendJson(res, 502, { ok: false, error: `Payment gateway error: ${err.message}` });
      }
      return;
    }

    // ── Membership: Verify Order (Polling Fallback on Return Redirect) ────────
    if (req.method === 'GET' && url === '/api/membership/verify-order') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const parsedUrl = new URL(req.url, 'http://localhost');
      let orderId = parsedUrl.searchParams.get('orderId') || parsedUrl.searchParams.get('order_id') || parsedUrl.searchParams.get('link_id');

      if (!orderId) {
        const latestPending = await Subscription.findOne({
          userId: auth.id,
          status: 'PENDING',
        }).sort({ createdAt: -1 });
        if (latestPending) orderId = latestPending.gatewayOrderId;
      }

      if (!orderId) {
        sendJson(res, 400, { ok: false, error: 'orderId parameter is required' });
        return;
      }

      // 1. Is subscription already ACTIVE?
      const activeSub = await Subscription.findOne({
        userId: auth.id,
        gatewayOrderId: orderId,
        status: 'ACTIVE',
      });
      if (activeSub) {
        const userObj = await User.findById(auth.id);
        sendJson(res, 200, {
          ok: true,
          status: 'PAID',
          plan: activeSub.plan,
          amount: activeSub.amount,
          expiresAt: activeSub.expiresAt,
          user: userObj ? safeUser(userObj) : null,
        });
        return;
      }

      // 2. Locate pending record
      const pendingSub = await Subscription.findOne({
        userId: auth.id,
        gatewayOrderId: orderId,
        status: 'PENDING',
      });

      const config = getCashfreeConfig();
      if (!config.isConfigured) {
        sendJson(res, 200, {
          ok: true,
          status: 'PENDING',
          message: 'Payment gateway credentials are not configured.',
        });
        return;
      }

      // 3. Query gateway directly
      const cashfreeStatus = await fetchCashfreeOrderStatus(orderId);
      if (String(cashfreeStatus).toUpperCase() === 'PAID') {
        const targetPlan = pendingSub?.plan || 'PRO';
        const targetInterval = pendingSub?.billingInterval || 'monthly';
        const targetAmount = pendingSub?.amount || 49900;
        const targetCurrency = pendingSub?.currency || 'INR';

        const activated = await activateSubscription({
          userId: auth.id,
          plan: targetPlan,
          billingInterval: targetInterval,
          amount: targetAmount,
          currency: targetCurrency,
          gateway: 'cashfree',
          gatewayOrderId: orderId,
          gatewayPaymentId: 'polling_verification',
        });

        if (pendingSub) {
          pendingSub.status = 'SUPERSEDED';
          await pendingSub.save();
        }

        await logAuditEvent({
          action: 'SUBSCRIPTION_ACTIVATED_POLL',
          req,
          actor: auth,
          details: { orderId, plan: targetPlan },
          outcome: 'SUCCESS',
        });

        const updatedUser = await User.findById(auth.id);
        sendJson(res, 200, {
          ok: true,
          status: 'PAID',
          plan: activated.plan,
          amount: activated.amount,
          expiresAt: activated.expiresAt,
          user: updatedUser ? safeUser(updatedUser) : null,
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        status: 'PENDING',
        gatewayStatus: cashfreeStatus || 'UNKNOWN',
        message: 'Payment is still processing.',
      });
      return;
    }

    // ── Membership: Gateway Webhook (HMAC-SHA256 Signature Verified) ─────────
    if (req.method === 'POST' && url === '/api/membership/webhook') {
      const rawPayload = await readRawBody(req);
      const signature = req.headers['x-webhook-signature'] || '';

      const config = getCashfreeConfig();
      if (!config.isConfigured) {
        sendJson(res, 400, { ok: false, error: 'Cashfree gateway is not configured' });
        return;
      }

      if (!verifyCashfreeWebhookSignature(rawPayload, signature)) {
        await logAuditEvent({
          action: 'PAYMENT_WEBHOOK_INVALID_SIGNATURE',
          req,
          details: { signatureProvided: Boolean(signature) },
          outcome: 'FAILURE',
        });
        sendJson(res, 401, { ok: false, error: 'Invalid webhook signature' });
        return;
      }

      let parsed = {};
      try { parsed = JSON.parse(rawPayload); } catch { parsed = {}; }

      const eventType = parsed.type || '';
      const orderId = parsed.data?.order?.order_id || '';
      const orderStatus = parsed.data?.order?.order_status || '';
      const paymentId = parsed.data?.payment?.cf_payment_id || '';

      if (eventType !== 'PAYMENT_SUCCESS_WEBHOOK' || String(orderStatus).toUpperCase() !== 'PAID') {
        sendJson(res, 200, { ok: true, message: 'Non-payment event ignored' });
        return;
      }

      // Atomic concurrency lock: transition PENDING -> PROCESSING
      const pendingSub = await Subscription.findOneAndUpdate(
        { gatewayOrderId: orderId, status: 'PENDING' },
        { $set: { status: 'PROCESSING' } },
        { new: true }
      );

      if (!pendingSub) {
        const existingSub = await Subscription.findOne({ gatewayOrderId: orderId, status: 'ACTIVE' });
        if (existingSub) {
          sendJson(res, 200, { ok: true, message: 'Subscription already active' });
          return;
        }
        sendJson(res, 200, { ok: true, message: 'Unknown or previously processed order' });
        return;
      }

      await activateSubscription({
        userId: pendingSub.userId,
        plan: pendingSub.plan,
        billingInterval: pendingSub.billingInterval,
        amount: pendingSub.amount,
        currency: pendingSub.currency,
        gateway: 'cashfree',
        gatewayOrderId: orderId,
        gatewayPaymentId: paymentId,
      });

      pendingSub.status = 'SUPERSEDED';
      await pendingSub.save();

      await logAuditEvent({
        action: 'SUBSCRIPTION_ACTIVATED_WEBHOOK',
        actor: { id: pendingSub.userId.toString() },
        details: { orderId, plan: pendingSub.plan, paymentId },
        outcome: 'SUCCESS',
      });

      await dispatchNotification({
        userId: pendingSub.userId,
        title: `Welcome to CodeSense ${PLANS[pendingSub.plan]?.name || pendingSub.plan}!`,
        message: `Your membership has been activated. Enjoy expanded review quotas and deep technical documentation insights.`,
        type: 'subscription',
        link: '/settings/profile',
        buttonText: 'View Membership Benefits',
      });

      sendJson(res, 200, { ok: true, message: 'Subscription activated' });
      return;
    }

    // ── Membership: Cancel Subscription ──────────────────────────────────────
    if (req.method === 'POST' && url === '/api/membership/cancel') {
      const auth = await requireAuth(req, res);
      if (!auth) return;

      const result = await cancelSubscription(auth.id);
      if (!result.success) {
        sendJson(res, 400, { ok: false, error: result.message });
        return;
      }

      await logAuditEvent({
        action: 'SUBSCRIPTION_CANCELLED',
        req,
        actor: auth,
        details: { expiresAt: result.expiresAt },
        outcome: 'SUCCESS',
      });

      await dispatchNotification({
        userId: auth.id,
        title: 'Subscription Cancelled',
        message: result.message,
        type: 'subscription',
        link: '/settings/profile',
        buttonText: 'Manage Subscription',
      });

      sendJson(res, 200, { ok: true, message: result.message, expiresAt: result.expiresAt });
      return;
    }

    // ── Repository Review: Start Job (Quota & Permission Enforced) ───────────
    if (req.method === 'POST' && url === '/api/full-review/start') {
      const body = await readBody(req);
      const repoInput = (body.repoPath || '').trim();
      if (!repoInput) { sendJson(res, 400, { ok: false, error: 'repoPath is required' }); return; }

      const authUser = verifyToken(req);
      if (!authUser) {
        sendJson(res, 401, {
          ok: false,
          error: 'Sign in to run repository reviews under your monthly allowance.',
          code: 'AUTH_REQUIRED',
        });
        return;
      }

      const userDoc = await User.findById(authUser.id);
      if (!userDoc) {
        sendJson(res, 401, { ok: false, error: 'Account not found' });
        return;
      }

      if (userDoc.status === 'SUSPENDED') {
        sendJson(res, 403, { ok: false, error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' });
        return;
      }

      // Hard server-side quota verification
      const quota = await checkReviewQuota(userDoc._id.toString(), userDoc.role);
      if (!quota.allowed) {
        sendJson(res, 403, {
          ok: false,
          error: quota.error,
          code: quota.code || 'QUOTA_EXCEEDED',
          plan: quota.plan,
          limit: quota.limit,
          used: quota.used,
          remaining: quota.remaining,
        });
        return;
      }

      const rev = await Review.create({ userId: userDoc._id, repo: repoInput, branch: body.branch || 'main' });
      const reviewId = rev._id;

      const jobId = crypto.randomBytes(8).toString('hex');
      console.log(`[job:${jobId}] ${repoInput} (user:${userDoc.email})`);
      startJob(jobId, repoInput, reviewId);
      sendJson(res, 200, { ok: true, jobId, remainingReviews: quota.remaining === -1 ? -1 : Math.max(0, quota.remaining - 1) }); return;
    }

    const pollMatch = url.match(/^\/api\/full-review\/status\/([a-f0-9]+)$/);
    if (req.method === 'GET' && pollMatch) {
      const job = jobs.get(pollMatch[1]);
      if (!job) { sendJson(res, 404, { ok: false, error: 'Job not found' }); return; }
      sendJson(res, 200, { ok: true, status: job.status, step: job.step, total: job.total, message: job.message, markdown: job.status === 'done' ? job.markdown : null, error: job.error }); return;
    }

    // ── History ───────────────────────────────────────────────────────────────

    if (req.method === 'GET' && url === '/api/history') {
      const auth = await requireAuth(req, res); if (!auth) return;
      const sub = await getUserActiveSubscription(auth.id, auth.role);
      const retentionLimit = sub.planDetails.limits.maxHistoryRetention;
      const queryLimit = retentionLimit === -1 ? 100 : Math.min(50, retentionLimit);

      const reviews = await Review.find({ userId: auth.id })
        .sort({ createdAt: -1 })
        .limit(queryLimit)
        .select('-markdown');
      sendJson(res, 200, { ok: true, reviews: reviews.map(r => ({
        id: r._id, repo: r.repo, branch: r.branch, status: r.status,
        elapsed_sec: r.elapsedSec, error: r.error,
        created_at: r.createdAt, finished_at: r.finishedAt,
      })) }); return;
    }

    const histMatch = url.match(/^\/api\/history\/([a-f0-9]+)\/markdown$/);
    if (req.method === 'GET' && histMatch) {
      const auth = await requireAuth(req, res); if (!auth) return;
      const review = await Review.findById(histMatch[1]);
      if (!review) { sendJson(res, 404, { ok: false, error: 'Review not found' }); return; }

      // Resource-level authorization: private reports belong strictly to owner
      if (review.userId.toString() !== auth.id) {
        await logAuditEvent({
          action: 'UNAUTHORIZED_REPORT_ACCESS',
          req,
          actor: auth,
          details: { reviewId: histMatch[1], ownerId: review.userId.toString() },
          outcome: 'FAILURE',
        });
        sendJson(res, 403, { ok: false, error: 'Forbidden: Private analysis report belongs to another user' });
        return;
      }

      sendJson(res, 200, { ok: true, markdown: review.markdown }); return;
    }

    // ── Admin: List Users ─────────────────────────────────────────────────────

    if (req.method === 'GET' && url === '/api/admin/users') {
      const auth = await requirePermission(req, res, PERMISSIONS.USERS_READ);
      if (!auth) return;
      const users = await User.find().sort({ createdAt: -1 }).select('-password');
      sendJson(res, 200, { ok: true, users: users.map(safeUser) }); return;
    }

    // ── Admin: Role Assignment (SUPER_ADMIN only) ─────────────────────────────

    const roleMatch = url.match(/^\/api\/admin\/users\/([a-f0-9]+)\/role$/);
    if (req.method === 'PUT' && roleMatch) {
      const auth = await requirePermission(req, res, PERMISSIONS.ROLES_ASSIGN);
      if (!auth) return;

      const targetId = roleMatch[1];
      const { role } = await readBody(req);
      const desiredRole = normalizeRole(role);

      if (![ROLES.USER, ROLES.ADMIN].includes(desiredRole)) {
        sendJson(res, 400, { ok: false, error: 'Target role must be USER or ADMIN' });
        return;
      }

      const targetUser = await User.findById(targetId);
      if (!targetUser) {
        sendJson(res, 404, { ok: false, error: 'Target user not found' });
        return;
      }

      // Safeguard: Protect the final active Super Admin against demotion
      if (targetUser.role === ROLES.SUPER_ADMIN && desiredRole !== ROLES.SUPER_ADMIN) {
        const superAdminCount = await User.countDocuments({ role: ROLES.SUPER_ADMIN, status: 'ACTIVE' });
        if (superAdminCount <= 1) {
          sendJson(res, 400, {
            ok: false,
            error: 'Cannot demote the final active Super Admin. At least one active Super Admin must be maintained.',
          });
          return;
        }
      }

      const previousRole = targetUser.role;
      targetUser.role = desiredRole;
      targetUser.tokenVersion = (targetUser.tokenVersion || 0) + 1;
      await targetUser.save();

      await logAuditEvent({
        action: 'ROLE_ASSIGN',
        req,
        actor: auth,
        target: targetUser,
        details: { previousRole, newRole: desiredRole },
        outcome: 'SUCCESS',
      });

      sendJson(res, 200, { ok: true, user: safeUser(targetUser) });
      return;
    }

    // ── Admin: Account Status (Suspend / Reactivate) ───────────────────────────

    const statusMatch = url.match(/^\/api\/admin\/users\/([a-f0-9]+)\/status$/);
    if (req.method === 'PUT' && statusMatch) {
      const auth = await requirePermission(req, res, PERMISSIONS.USERS_MANAGE);
      if (!auth) return;

      const targetId = statusMatch[1];
      const { status } = await readBody(req);
      const desiredStatus = String(status || '').toUpperCase();

      if (!['ACTIVE', 'SUSPENDED'].includes(desiredStatus)) {
        sendJson(res, 400, { ok: false, error: 'Status must be ACTIVE or SUSPENDED' });
        return;
      }

      const targetUser = await User.findById(targetId);
      if (!targetUser) {
        sendJson(res, 404, { ok: false, error: 'Target user not found' });
        return;
      }

      if (!canManageTargetAccount(auth.role, targetUser.role)) {
        await logAuditEvent({
          action: 'UNAUTHORIZED_STATUS_CHANGE_ATTEMPT',
          req,
          actor: auth,
          target: targetUser,
          details: { attemptedStatus: desiredStatus, targetRole: targetUser.role },
          outcome: 'FAILURE',
        });
        sendJson(res, 403, { ok: false, error: 'Forbidden: Insufficient privileges to modify this account status' });
        return;
      }

      // Safeguard: Protect the final Super Admin against suspension
      if (targetUser.role === ROLES.SUPER_ADMIN && desiredStatus === 'SUSPENDED') {
        const superAdminCount = await User.countDocuments({ role: ROLES.SUPER_ADMIN, status: 'ACTIVE' });
        if (superAdminCount <= 1) {
          sendJson(res, 400, {
            ok: false,
            error: 'Cannot suspend the final active Super Admin account.',
          });
          return;
        }
      }

      const previousStatus = targetUser.status;
      targetUser.status = desiredStatus;
      targetUser.tokenVersion = (targetUser.tokenVersion || 0) + 1;
      await targetUser.save();

      await logAuditEvent({
        action: desiredStatus === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_REACTIVATED',
        req,
        actor: auth,
        target: targetUser,
        details: { previousStatus, newStatus: desiredStatus },
        outcome: 'SUCCESS',
      });

      sendJson(res, 200, { ok: true, user: safeUser(targetUser) });
      return;
    }

    // ── Admin: Delete User ────────────────────────────────────────────────────

    const deleteMatch = url.match(/^\/api\/admin\/users\/([a-f0-9]+)$/);
    if (req.method === 'DELETE' && deleteMatch) {
      const auth = await requirePermission(req, res, PERMISSIONS.USERS_MANAGE);
      if (!auth) return;

      const targetId = deleteMatch[1];
      if (targetId === auth.id) {
        sendJson(res, 400, { ok: false, error: 'Cannot delete yourself through administrative user management' });
        return;
      }

      const targetUser = await User.findById(targetId);
      if (!targetUser) {
        sendJson(res, 404, { ok: false, error: 'User not found' });
        return;
      }

      if (!canManageTargetAccount(auth.role, targetUser.role)) {
        await logAuditEvent({
          action: 'UNAUTHORIZED_USER_DELETE_ATTEMPT',
          req,
          actor: auth,
          target: targetUser,
          details: { targetRole: targetUser.role },
          outcome: 'FAILURE',
        });
        sendJson(res, 403, { ok: false, error: 'Forbidden: Insufficient privileges to delete this account' });
        return;
      }

      // Safeguard: Protect the final Super Admin against deletion
      if (targetUser.role === ROLES.SUPER_ADMIN) {
        const superAdminCount = await User.countDocuments({ role: ROLES.SUPER_ADMIN, status: 'ACTIVE' });
        if (superAdminCount <= 1) {
          sendJson(res, 400, { ok: false, error: 'Cannot delete the final active Super Admin account' });
          return;
        }
      }

      await Review.deleteMany({ userId: targetId });
      await Notification.deleteMany({ userId: targetId });
      await User.findByIdAndDelete(targetId);

      await logAuditEvent({
        action: 'USER_DELETED',
        req,
        actor: auth,
        target: targetUser,
        details: { deletedEmail: targetUser.email, deletedRole: targetUser.role },
        outcome: 'SUCCESS',
      });

      sendJson(res, 200, { ok: true });
      return;
    }

    // ── Admin: Membership Management (Override / Correction) ──────────────────
    const adminMemMatch = url.match(/^\/api\/admin\/users\/([a-f0-9]+)\/membership$/);
    if ((req.method === 'POST' || req.method === 'PUT') && adminMemMatch) {
      const auth = await requirePermission(req, res, PERMISSIONS.USERS_MANAGE);
      if (!auth) return;

      const targetId = adminMemMatch[1];
      const targetUser = await User.findById(targetId);
      if (!targetUser) {
        sendJson(res, 404, { ok: false, error: 'User not found' });
        return;
      }

      const body = await readBody(req);
      const newPlan = normalizePlan(body.plan);
      const durationMonths = Number(body.durationMonths || (body.billingInterval === 'yearly' ? 12 : 1));
      const oldPlan = targetUser.membershipPlan || 'FREE';

      if (newPlan === 'FREE') {
        await Subscription.updateMany(
          { userId: targetId, status: 'ACTIVE' },
          { $set: { status: 'CANCELLED', cancelledAt: new Date() } }
        );
      } else {
        await activateSubscription({
          userId: targetId,
          plan: newPlan,
          billingInterval: durationMonths >= 12 ? 'yearly' : 'monthly',
          amount: 0,
          currency: 'INR',
          gateway: 'manual',
          gatewayOrderId: `admin_grant_${Date.now()}`,
        });
      }

      targetUser.membershipPlan = newPlan;
      await targetUser.save();

      await logAuditEvent({
        action: 'ADMIN_MEMBERSHIP_OVERRIDE',
        req,
        actor: auth,
        target: targetUser,
        details: { oldPlan, newPlan, durationMonths },
        outcome: 'SUCCESS',
      });

      sendJson(res, 200, {
        ok: true,
        message: `User membership successfully updated to ${newPlan}`,
        user: safeUser(targetUser),
      });
      return;
    }

    // ── Admin: Membership Overview Stats ──────────────────────────────────────
    if (req.method === 'GET' && url === '/api/admin/membership-stats') {
      const auth = await requirePermission(req, res, PERMISSIONS.ADMIN_ACCESS);
      if (!auth) return;

      const [freeCount, proCount, enterpriseCount, totalSubs, recentActive] = await Promise.all([
        User.countDocuments({ membershipPlan: 'FREE' }),
        User.countDocuments({ membershipPlan: 'PRO' }),
        User.countDocuments({ membershipPlan: 'ENTERPRISE' }),
        Subscription.countDocuments(),
        Subscription.find({ status: 'ACTIVE' })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('userId', 'email name'),
      ]);

      sendJson(res, 200, {
        ok: true,
        stats: {
          freeCount,
          proCount,
          enterpriseCount,
          totalSubscriptions: totalSubs,
        },
        recentSubscriptions: recentActive.map(s => ({
          id: s._id,
          userEmail: s.userId?.email,
          userName: s.userId?.name,
          plan: s.plan,
          billingInterval: s.billingInterval,
          amount: s.amount,
          status: s.status,
          expiresAt: s.expiresAt,
          createdAt: s.createdAt,
        })),
      });
      return;
    }

    // ── Admin: Operational Reviews Listing (Metadata Only, No Private Markdown) ──

    if (req.method === 'GET' && url === '/api/admin/reviews') {
      const auth = await requirePermission(req, res, PERMISSIONS.ADMIN_ACCESS);
      if (!auth) return;

      const reviews = await Review.find()
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('userId', 'email name')
        .select('-markdown');

      sendJson(res, 200, { ok: true, reviews: reviews.map(r => ({
        id: r._id, repo: r.repo, branch: r.branch, status: r.status,
        elapsed_sec: r.elapsedSec, error: r.error,
        created_at: r.createdAt, finished_at: r.finishedAt,
        email: r.userId?.email, name: r.userId?.name,
      })) });
      return;
    }

    // ── Admin: Security & Audit Logs ──────────────────────────────────────────

    if (req.method === 'GET' && url === '/api/admin/audit-logs') {
      const auth = await requirePermission(req, res, PERMISSIONS.AUDIT_READ);
      if (!auth) return;

      const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100);
      sendJson(res, 200, {
        ok: true,
        logs: logs.map(l => ({
          id: l._id.toString(),
          action: l.action,
          actor_email: l.actorEmail,
          actor_role: l.actorRole,
          target_email: l.targetEmail,
          details: l.details,
          outcome: l.outcome,
          ip: l.ip,
          created_at: l.createdAt,
        })),
      });
      return;
    }

    // ── Chat / RAG ────────────────────────────────────────────────────────────
    if (url.startsWith('/api/chat/')) {
      const CHAT_BASE = process.env.CHAT_SERVICE_URL || 'http://127.0.0.1:8000';

      const proxyChatReq = async (method, chatPath, bodyObj) => {
        const opts = {
          method,
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(600000), // 10 minute timeout for LLM CPU generation
        };
        if (bodyObj) opts.body = JSON.stringify(bodyObj);
        const r = await fetch(`${CHAT_BASE}${chatPath}`, opts);
        const data = await r.json();
        sendJson(res, r.status, data);
      };

      // POST /api/chat/index
      if (req.method === 'POST' && url === '/api/chat/index') {
        const auth = await requireAuth(req, res); if (!auth) return;
        const { reviewId, force } = await readBody(req);
        if (!reviewId) { sendJson(res, 400, { ok: false, error: 'reviewId required' }); return; }
        const review = await Review.findById(reviewId);
        if (!review) { sendJson(res, 404, { ok: false, error: 'Review not found' }); return; }
        if (review.userId.toString() !== auth.id) { sendJson(res, 403, { ok: false, error: 'Forbidden: Cannot index private review of another user' }); return; }
        if (!review.markdown) { sendJson(res, 400, { ok: false, error: 'Review has no markdown yet' }); return; }
        try { await proxyChatReq('POST', '/chat/index', { review_id: reviewId, markdown: review.markdown, repo_name: review.repo, force: !!force }); }
        catch (e) { sendJson(res, 503, { ok: false, error: `Chat service unavailable: ${e.message}` }); }
        return;
      }

      // GET /api/chat/index/:reviewId/status
      const csMatch = url.match(/^\/api\/chat\/index\/([a-f0-9]+)\/status$/);
      if (req.method === 'GET' && csMatch) {
        const auth = await requireAuth(req, res); if (!auth) return;
        const review = await Review.findById(csMatch[1]).select('userId');
        if (!review) { sendJson(res, 404, { ok: false, error: 'Review not found' }); return; }
        if (review.userId.toString() !== auth.id) { sendJson(res, 403, { ok: false, error: 'Forbidden' }); return; }
        try { await proxyChatReq('GET', `/chat/index/${csMatch[1]}/status`, null); }
        catch (e) { sendJson(res, 503, { ok: false, error: `Chat service unavailable: ${e.message}` }); }
        return;
      }

      // POST /api/chat/ask
      if (req.method === 'POST' && url === '/api/chat/ask') {
        const auth = await requireAuth(req, res); if (!auth) return;
        const body = await readBody(req);
        const { reviewId, sessionId, question } = body;
        if (!reviewId || !question) { sendJson(res, 400, { ok: false, error: 'reviewId and question required' }); return; }
        const review = await Review.findById(reviewId).select('userId repo');
        if (!review) { sendJson(res, 404, { ok: false, error: 'Review not found' }); return; }
        if (review.userId.toString() !== auth.id) { sendJson(res, 403, { ok: false, error: 'Forbidden: Private review belongs to another user' }); return; }

        // Hard server-side AI chat quota verification
        const chatQuota = await checkChatQuota(auth.id, auth.role);
        if (!chatQuota.allowed) {
          sendJson(res, 403, {
            ok: false,
            error: chatQuota.error,
            code: chatQuota.code || 'CHAT_QUOTA_EXCEEDED',
            limit: chatQuota.limit,
            used: chatQuota.used,
            remaining: chatQuota.remaining,
          });
          return;
        }

        await recordChatUsage(auth.id);

        try { await proxyChatReq('POST', '/chat/ask', { review_id: reviewId, session_id: sessionId || null, question, repo_name: review.repo }); }
        catch (e) { sendJson(res, 503, { ok: false, error: `Chat service unavailable: ${e.message}` }); }
        return;
      }

      // POST /api/chat/ask/stream (SSE streaming)
      if (req.method === 'POST' && url === '/api/chat/ask/stream') {
        const auth = await requireAuth(req, res); if (!auth) return;
        const body = await readBody(req);
        const { reviewId, sessionId, question } = body;
        if (!reviewId || !question) { sendJson(res, 400, { ok: false, error: 'reviewId and question required' }); return; }
        const review = await Review.findById(reviewId).select('userId repo');
        if (!review) { sendJson(res, 404, { ok: false, error: 'Review not found' }); return; }
        if (review.userId.toString() !== auth.id) { sendJson(res, 403, { ok: false, error: 'Forbidden: Private review belongs to another user' }); return; }

        // Hard server-side AI chat quota verification
        const chatQuota = await checkChatQuota(auth.id, auth.role);
        if (!chatQuota.allowed) {
          sendJson(res, 403, {
            ok: false,
            error: chatQuota.error,
            code: chatQuota.code || 'CHAT_QUOTA_EXCEEDED',
            limit: chatQuota.limit,
            used: chatQuota.used,
            remaining: chatQuota.remaining,
          });
          return;
        }

        await recordChatUsage(auth.id);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });

        const CHAT_BASE = process.env.CHAT_SERVICE_URL || 'http://127.0.0.1:8000';
        try {
          const streamRes = await fetch(`${CHAT_BASE}/chat/ask/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ review_id: reviewId, session_id: sessionId || null, question, repo_name: review.repo }),
          });

          if (!streamRes.body) {
            res.end();
            return;
          }

          const reader = streamRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
          res.end();
        } catch (e) {
          res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
          res.end();
        }
        return;
      }

      // GET /api/chat/session/:sessionId
      // DELETE /api/chat/session/:sessionId
      const sessMatch = url.match(/^\/api\/chat\/session\/([a-zA-Z0-9_-]+)$/);
      if (sessMatch && (req.method === 'GET' || req.method === 'DELETE')) {
        const auth = await requireAuth(req, res); if (!auth) return;
        try { await proxyChatReq(req.method, `/chat/session/${sessMatch[1]}`, null); }
        catch (e) { sendJson(res, 503, { ok: false, error: `Chat service unavailable: ${e.message}` }); }
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Chat route not found' }); return;
    }

    // ── Legacy quick diff ─────────────────────────────────────────────────────

    if (req.method === 'POST' && url === '/api/review') {
      sendJson(res, 400, { ok: false, message: 'Endpoint deprecated. Please use /api/full-review/start for CodeSense analysis.' });
      return;
    }

    sendJson(res, 404, { ok: false, message: 'Not found' });

  } catch (err) {
    console.error('[server error]', err);
    sendJson(res, 500, { ok: false, error: 'Internal server error' });
  }
});

// ── Start — server starts immediately if run directly, DB connects in background ──────────────
if (require.main === module) {
  server.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));

  // Connect to DB after server is up — retries automatically
  connectDB().then(() => {
    console.log('[db] Database ready');
  }).catch(err => {
    console.error('[db] All connection attempts failed:', err.message);
    console.log('[db] Server still running — auth routes will return 503 until DB reconnects');
  });
}

module.exports = server;
