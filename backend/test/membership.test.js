/**
 * CodeSense Membership & Quota Enforcement Test Suite
 *
 * Validates:
 * 1. Plan specifications & limits
 * 2. Current membership & usage resolution
 * 3. Server-side Review quota enforcement (FREE = 3 reviews/mo, blocked on 4th)
 * 4. AI Chat query quota checking
 * 5. Repurchase extension logic & old subscription superseding
 * 6. Subscription cancellation & grace period (access until expiresAt)
 * 7. RBAC isolation (Paid tier never grants ADMIN or SUPER_ADMIN)
 * 8. Administrative membership tier override with audit logging
 * 9. Cashfree webhook signature verification & idempotency
 */

process.env.NODE_ENV = 'test';
process.env.DISABLE_EMAIL = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { connectDB, User, Review, Subscription, ChatUsage, AuditLog } = require('../db');
const {
  PLANS,
  getUserActiveSubscription,
  getUserUsageStats,
  checkReviewQuota,
  checkChatQuota,
  activateSubscription,
  cancelSubscription,
  verifyCashfreeWebhookSignature,
} = require('../membership');
const { ROLES, hasPermission, PERMISSIONS } = require('../rbac');

let BASE_URL;
let server;
const JWT_SECRET = process.env.JWT_SECRET || 'codesense-jwt-secret-lokesh-2024';

function makeToken(user) {
  return jwt.sign({
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion || 0,
  }, JWT_SECRET, { expiresIn: '1d' });
}

async function req(path, { method = 'GET', headers = {}, body = null } = {}) {
  const opts = {
    method,
    headers: { ...headers },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

describe('CodeSense Membership & Quota Enforcement Suite', () => {
  let testUserFree;
  let testUserPro;
  let adminUser;
  let superAdminUser;

  let freeToken;
  let proToken;
  let adminToken;
  let superAdminToken;

  before(async () => {
    await connectDB();

    server = require('../server');
    if (!server.listening) {
      await new Promise(resolve => server.listen(0, resolve));
    }
    if (typeof server.unref === 'function') {
      server.unref();
    }
    const port = server.address().port;
    BASE_URL = `http://127.0.0.1:${port}`;

    // Clean test fixture users
    await User.deleteMany({ email: { $regex: /@(memtest\.com|membership\.test)$/ } });
    await Subscription.deleteMany({});
    await ChatUsage.deleteMany({});
    await Review.deleteMany({ repo: { $regex: /(memtest-repo|membership-test)/ } });

    // Seed test users with RFC 2606 reserved .test domain (never routed on public internet)
    const hash = bcrypt.hashSync('Password123!', 10);

    testUserFree = await User.create({
      email: 'free_dev@membership.test',
      name: 'Free Developer',
      password: hash,
      role: 'USER',
      membershipPlan: 'FREE',
      emailVerified: true,
      status: 'ACTIVE',
    });

    testUserPro = await User.create({
      email: 'pro_dev@membership.test',
      name: 'Pro Developer',
      password: hash,
      role: 'USER',
      membershipPlan: 'PRO',
      emailVerified: true,
      status: 'ACTIVE',
    });

    adminUser = await User.create({
      email: 'admin_mem@membership.test',
      name: 'Admin Member',
      password: hash,
      role: 'ADMIN',
      emailVerified: true,
      status: 'ACTIVE',
    });

    superAdminUser = await User.create({
      email: 'superadmin_mem@membership.test',
      name: 'SuperAdmin Member',
      password: hash,
      role: 'SUPER_ADMIN',
      emailVerified: true,
      status: 'ACTIVE',
    });

    // Create an active PRO subscription for testUserPro
    const monthFromNow = new Date();
    monthFromNow.setMonth(monthFromNow.getMonth() + 1);

    await Subscription.create({
      userId: testUserPro._id,
      plan: 'PRO',
      status: 'ACTIVE',
      billingInterval: 'monthly',
      amount: 49900,
      currency: 'INR',
      startedAt: new Date(),
      expiresAt: monthFromNow,
    });

    freeToken = makeToken(testUserFree);
    proToken = makeToken(testUserPro);
    adminToken = makeToken(adminUser);
    superAdminToken = makeToken(superAdminUser);
  });

  after(async () => {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        await User.deleteMany({ email: { $regex: /@(memtest\.com|membership\.test)$/ } });
        await Subscription.deleteMany({});
        await ChatUsage.deleteMany({});
        await Review.deleteMany({ repo: { $regex: /(memtest-repo|membership-test)/ } });
      }
    } catch (_) {}
    finally {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    }
  });

  // ── 1. Plans Directory ──────────────────────────────────────────────────────
  it('1. GET /api/membership/plans returns public plans directory with limits', async () => {
    const res = await req('/api/membership/plans');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.ok, true);
    assert.ok(res.data.plans.FREE);
    assert.ok(res.data.plans.PRO);
    assert.ok(res.data.plans.ENTERPRISE);

    assert.strictEqual(res.data.plans.FREE.limits.reviewsPerMonth, 3);
    assert.strictEqual(res.data.plans.PRO.limits.reviewsPerMonth, 50);
    assert.strictEqual(res.data.plans.ENTERPRISE.limits.reviewsPerMonth, -1);
  });

  // ── 2. Current Membership & Usage Stats ─────────────────────────────────────
  it('2. GET /api/membership/current returns user plan and accurate quota stats', async () => {
    const resFree = await req('/api/membership/current', {
      headers: { Authorization: `Bearer ${freeToken}` },
    });
    assert.strictEqual(resFree.status, 200);
    assert.strictEqual(resFree.data.ok, true);
    assert.strictEqual(resFree.data.subscription.plan, 'FREE');
    assert.strictEqual(resFree.data.subscription.reviews.limit, 3);
    assert.strictEqual(resFree.data.subscription.reviews.used, 0);
    assert.strictEqual(resFree.data.subscription.reviews.remaining, 3);

    const resPro = await req('/api/membership/current', {
      headers: { Authorization: `Bearer ${proToken}` },
    });
    assert.strictEqual(resPro.status, 200);
    assert.strictEqual(resPro.data.subscription.plan, 'PRO');
    assert.strictEqual(resPro.data.subscription.reviews.limit, 50);
    assert.strictEqual(resPro.data.subscription.status, 'ACTIVE');
  });

  // ── 3. Hard Quota Enforcement on Repository Review ──────────────────────────
  it('3. POST /api/full-review/start strictly enforces monthly quota (3 reviews for Free)', async () => {
    // Attempt unauthenticated review -> rejects with 401 AUTH_REQUIRED
    const unauthRes = await req('/api/full-review/start', {
      method: 'POST',
      body: { repoPath: 'https://github.com/membership-test/test-repo-0' },
    });
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthRes.data.code, 'AUTH_REQUIRED');

    // Simulate 3 reviews performed this month by free developer
    const now = new Date();
    for (let i = 1; i <= 3; i++) {
      await Review.create({
        userId: testUserFree._id,
        repo: `https://github.com/membership-test/test-repo-${i}`,
        branch: 'main',
        status: 'done',
        createdAt: now,
      });
    }

    // 4th review attempt MUST be rejected by server with 403 QUOTA_EXCEEDED
    const fourthRes = await req('/api/full-review/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${freeToken}` },
      body: { repoPath: 'https://github.com/membership-test/test-repo-4' },
    });

    assert.strictEqual(fourthRes.status, 403);
    assert.strictEqual(fourthRes.data.ok, false);
    assert.strictEqual(fourthRes.data.code, 'QUOTA_EXCEEDED');
    assert.strictEqual(fourthRes.data.limit, 3);
    assert.strictEqual(fourthRes.data.remaining, 0);
  });

  // ── 4. AI Codebase Chat Quota Enforcement ───────────────────────────────────
  it('4. POST /api/chat/ask enforces AI Chat question quota', async () => {
    const quotaCheck = await checkChatQuota(testUserFree._id.toString(), 'USER');
    assert.strictEqual(quotaCheck.allowed, true);
    assert.strictEqual(quotaCheck.limit, 20);

    // Simulate exhausting free chat limit
    const ym = `${nowYearMonth()}`;
    await ChatUsage.findOneAndUpdate(
      { userId: testUserFree._id, yearMonth: ym },
      { $set: { count: 20 } },
      { upsert: true }
    );

    const exceededCheck = await checkChatQuota(testUserFree._id.toString(), 'USER');
    assert.strictEqual(exceededCheck.allowed, false);
    assert.strictEqual(exceededCheck.code, 'CHAT_QUOTA_EXCEEDED');
  });

  // ── 5. Repurchase Extension Logic ───────────────────────────────────────────
  it('5. Repurchase extends existing expiresAt without losing active days and supersedes old', async () => {
    const existingSub = await Subscription.findOne({ userId: testUserPro._id, status: 'ACTIVE' });
    assert.ok(existingSub);
    const originalExpiry = new Date(existingSub.expiresAt);

    // Repurchase 1 month
    const newSub = await activateSubscription({
      userId: testUserPro._id,
      plan: 'PRO',
      billingInterval: 'monthly',
      amount: 49900,
      currency: 'INR',
      gateway: 'cashfree',
      gatewayOrderId: 'order_repurchase_123',
    });

    assert.strictEqual(newSub.status, 'ACTIVE');
    // New expiry should be 1 month after originalExpiry
    const expectedExpiry = new Date(originalExpiry);
    expectedExpiry.setMonth(expectedExpiry.getMonth() + 1);

    assert.strictEqual(newSub.expiresAt.toISOString(), expectedExpiry.toISOString());

    // Verify old sub was marked SUPERSEDED
    const reloadedOld = await Subscription.findById(existingSub._id);
    assert.strictEqual(reloadedOld.status, 'SUPERSEDED');
  });

  // ── 6. Cancellation Grace Period ───────────────────────────────────────────
  it('6. POST /api/membership/cancel sets CANCELLED and preserves access until expiresAt', async () => {
    const cancelRes = await req('/api/membership/cancel', {
      method: 'POST',
      headers: { Authorization: `Bearer ${proToken}` },
    });

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.data.ok, true);

    // Verify user still has PRO access because expiresAt is in the future
    const activeCheck = await getUserActiveSubscription(testUserPro._id.toString(), 'USER');
    assert.strictEqual(activeCheck.plan, 'PRO');
    assert.strictEqual(activeCheck.status, 'CANCELLED');
    assert.ok(activeCheck.expiresAt > new Date());
  });

  // ── 7. Strict RBAC-Membership Privilege Isolation ───────────────────────────
  it('7. Upgrading membership tier never grants ADMIN or SUPER_ADMIN privileges', async () => {
    // testUserPro is on paid tier, but role is strictly USER
    const dbUser = await User.findById(testUserPro._id);
    assert.strictEqual(dbUser.role, ROLES.USER);

    // Paid user CANNOT access admin endpoints
    const adminAccess = await req('/api/admin/users', {
      headers: { Authorization: `Bearer ${proToken}` },
    });
    assert.strictEqual(adminAccess.status, 403);

    // Paid user holds 0 administrative permissions
    assert.strictEqual(hasPermission(dbUser.role, PERMISSIONS.ADMIN_ACCESS), false);
    assert.strictEqual(hasPermission(dbUser.role, PERMISSIONS.USERS_MANAGE), false);
    assert.strictEqual(hasPermission(dbUser.role, PERMISSIONS.ROLES_ASSIGN), false);
  });

  // ── 8. Admin Manual Membership Override & Audit Trail ───────────────────────
  it('8. Administrator can grant/override membership with audit logging', async () => {
    const overrideRes = await req(`/api/admin/users/${testUserFree._id}/membership`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: { plan: 'ENTERPRISE', durationMonths: 6 },
    });

    assert.strictEqual(overrideRes.status, 200);
    assert.strictEqual(overrideRes.data.ok, true);
    assert.strictEqual(overrideRes.data.user.membershipPlan, 'ENTERPRISE');

    // Verify AuditLog record was generated
    const auditRecord = await AuditLog.findOne({
      action: 'ADMIN_MEMBERSHIP_OVERRIDE',
      targetId: testUserFree._id,
    });
    assert.ok(auditRecord);
    assert.strictEqual(auditRecord.actorRole, 'SUPER_ADMIN');
    assert.strictEqual(auditRecord.details.newPlan, 'ENTERPRISE');
  });

  // ── 9. Cashfree Webhook Signature Verification ──────────────────────────────
  it('9. Cashfree webhook rejects forged signatures and accepts authentic HMAC', async () => {
    // When webhook secret is configured in env
    process.env.CASHFREE_WEBHOOK_SECRET = 'test_webhook_secret_key_12345';
    process.env.CASHFREE_APP_ID = 'test_app_id';
    process.env.CASHFREE_SECRET_KEY = 'test_secret_key';

    const testPayload = JSON.stringify({
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: 'order_webhook_test_1', order_status: 'PAID' },
        payment: { cf_payment_id: 'cf_pay_999' },
      },
    });

    // 1. Forged signature
    const isInvalid = verifyCashfreeWebhookSignature(testPayload, 'forged_fake_signature');
    assert.strictEqual(isInvalid, false);

    // 2. Real HMAC-SHA256 signature
    const validSignature = crypto
      .createHmac('sha256', process.env.CASHFREE_WEBHOOK_SECRET)
      .update(testPayload)
      .digest('hex');
    const isValid = verifyCashfreeWebhookSignature(testPayload, validSignature);
    assert.strictEqual(isValid, true);
  });

  // ── 10. Cashfree Webhook Idempotency & Deduplication ───────────────────────
  it('10. Duplicate Cashfree webhook events are processed idempotently without side effects', async () => {
    process.env.CASHFREE_WEBHOOK_SECRET = 'test_webhook_secret_key_12345';
    process.env.CASHFREE_APP_ID = 'test_app_id';
    process.env.CASHFREE_SECRET_KEY = 'test_secret_key';

    const testOrderId = `order_idemp_${Date.now()}`;

    // Seed PENDING subscription
    await Subscription.create({
      userId: testUserFree._id,
      plan: 'PRO',
      status: 'PENDING',
      billingInterval: 'monthly',
      amount: 49900,
      currency: 'INR',
      gateway: 'cashfree',
      gatewayOrderId: testOrderId,
      startedAt: new Date(),
    });

    const payloadObj = {
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: testOrderId, order_status: 'PAID' },
        payment: { cf_payment_id: `cf_pay_${Date.now()}` },
      },
    };
    const rawPayload = JSON.stringify(payloadObj);
    const signature = crypto
      .createHmac('sha256', process.env.CASHFREE_WEBHOOK_SECRET)
      .update(rawPayload)
      .digest('hex');

    // 1st Webhook delivery -> Activates subscription
    const res1 = await req('/api/membership/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
      },
      body: payloadObj,
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.data.ok, true);

    const activeSubs1 = await Subscription.countDocuments({
      userId: testUserFree._id,
      gatewayOrderId: testOrderId,
      status: 'ACTIVE',
    });
    assert.strictEqual(activeSubs1, 1);

    // 2nd Webhook delivery (exact duplicate / retry) -> Must be idempotent, no duplicate active sub
    const res2 = await req('/api/membership/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
      },
      body: payloadObj,
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.data.ok, true);

    // Active subscription count MUST remain exactly 1
    const activeSubs2 = await Subscription.countDocuments({
      userId: testUserFree._id,
      gatewayOrderId: testOrderId,
      status: 'ACTIVE',
    });
    assert.strictEqual(activeSubs2, 1);
  });

  // ── 11. Transactional Email Security & Test Domain Suppression ──────────────
  it('11. isTestRecipient blocks RFC 2606 domains, memtest.com, and test accounts from live SMTP', async () => {
    const { isTestRecipient, sendNotificationEmail } = require('../email');

    // All test / fixture domains MUST be identified as test recipients
    assert.strictEqual(isTestRecipient('pro_dev@memtest.com'), true);
    assert.strictEqual(isTestRecipient('free_dev@memtest.com'), true);
    assert.strictEqual(isTestRecipient('dev@membership.test'), true);
    assert.strictEqual(isTestRecipient('admin@codesense.test'), true);
    assert.strictEqual(isTestRecipient('user@example.com'), true);
    assert.strictEqual(isTestRecipient('user@localhost'), true);
    assert.strictEqual(isTestRecipient('invalid_email_no_domain'), true);
    assert.strictEqual(isTestRecipient(''), true);
    assert.strictEqual(isTestRecipient(null), true);

    // Live valid email is not a test recipient
    assert.strictEqual(isTestRecipient('legitimate_user@gmail.com'), false);

    // sendNotificationEmail must simulate and bypass live SMTP delivery for test address
    const result = await sendNotificationEmail({
      to: 'pro_dev@memtest.com',
      title: 'Subscription Cancelled',
      message: 'Paid access preserved until end of cycle.',
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.simulated, true);
  });

  // ── 12. Subscription Cancellation Safety ────────────────────────────────────
  it('12. Cancelling when no active subscription exists returns safe terminal 400 without notifications', async () => {
    // testUserPro already had its subscription cancelled in test 6
    const doubleCancelRes = await req('/api/membership/cancel', {
      method: 'POST',
      headers: { Authorization: `Bearer ${proToken}` },
    });

    assert.strictEqual(doubleCancelRes.status, 400);
    assert.strictEqual(doubleCancelRes.data.ok, false);
    assert.strictEqual(doubleCancelRes.data.error, 'No active subscription found to cancel.');
  });
});

function nowYearMonth() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}
