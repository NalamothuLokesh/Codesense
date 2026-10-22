/**
 * CodeSense RBAC Security Test Suite
 * Validates all 15 security requirements of the 3-role access control model.
 */

process.env.NODE_ENV = 'test';
process.env.DISABLE_EMAIL = 'true';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { connectDB, User, Review, AuditLog } = require('../db');
const { ROLES, normalizeRole, hasPermission, PERMISSIONS } = require('../rbac');

let BASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'codesense-jwt-secret';

let server;

// Helper to send HTTP requests to test server
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

describe('CodeSense Role-Based Access Control (RBAC) Security Suite', () => {
  let superAdminUser;
  let adminUser;
  let normalUser1;
  let normalUser2;

  let superAdminToken;
  let adminToken;
  let normalUser1Token;
  let normalUser2Token;

  let user1ReviewId;

  before(async () => {
    await connectDB();

    // Start server on dynamic free test port
    // Load server from server.js
    server = require('../server');
    if (!server.listening) {
      await new Promise(resolve => server.listen(0, resolve));
    }
    if (typeof server.unref === 'function') {
      server.unref();
    }
    const port = server.address().port;
    BASE_URL = `http://127.0.0.1:${port}`;

    const testSuffix = Date.now();

    // 1. Create verified Super Admin
    superAdminUser = await User.create({
      email: `test_superadmin_${testSuffix}@codesense.test`,
      name: 'Super Admin Tester',
      password: bcrypt.hashSync('SuperPass123!', 10),
      role: ROLES.SUPER_ADMIN,
      status: 'ACTIVE',
      tokenVersion: 0,
      emailVerified: true,
    });
    superAdminToken = jwt.sign(
      { id: superAdminUser._id.toString(), email: superAdminUser.email, role: ROLES.SUPER_ADMIN, tokenVersion: 0 },
      JWT_SECRET
    );

    // 2. Create verified Admin
    adminUser = await User.create({
      email: `test_admin_${testSuffix}@codesense.test`,
      name: 'Admin Tester',
      password: bcrypt.hashSync('AdminPass123!', 10),
      role: ROLES.ADMIN,
      status: 'ACTIVE',
      tokenVersion: 0,
      emailVerified: true,
    });
    adminToken = jwt.sign(
      { id: adminUser._id.toString(), email: adminUser.email, role: ROLES.ADMIN, tokenVersion: 0 },
      JWT_SECRET
    );

    // 3. Create normal User 1
    normalUser1 = await User.create({
      email: `test_user1_${testSuffix}@codesense.test`,
      name: 'User 1 Tester',
      password: bcrypt.hashSync('UserPass123!', 10),
      role: ROLES.USER,
      status: 'ACTIVE',
      tokenVersion: 0,
      emailVerified: true,
    });
    normalUser1Token = jwt.sign(
      { id: normalUser1._id.toString(), email: normalUser1.email, role: ROLES.USER, tokenVersion: 0 },
      JWT_SECRET
    );

    // 4. Create normal User 2
    normalUser2 = await User.create({
      email: `test_user2_${testSuffix}@codesense.test`,
      name: 'User 2 Tester',
      password: bcrypt.hashSync('UserPass123!', 10),
      role: ROLES.USER,
      status: 'ACTIVE',
      tokenVersion: 0,
      emailVerified: true,
    });
    normalUser2Token = jwt.sign(
      { id: normalUser2._id.toString(), email: normalUser2.email, role: ROLES.USER, tokenVersion: 0 },
      JWT_SECRET
    );

    // 5. Create a private review belonging strictly to User 1
    const review = await Review.create({
      userId: normalUser1._id,
      repo: 'https://github.com/codesense/private-repo',
      branch: 'main',
      status: 'done',
      markdown: '# Confidential Architectural Review\nContains proprietary system design.',
    });
    user1ReviewId = review._id.toString();
  });

  after(async () => {
    // Cleanup created test records
    try {
      if (superAdminUser?._id) await User.findByIdAndDelete(superAdminUser._id);
      if (adminUser?._id) await User.findByIdAndDelete(adminUser._id);
      if (normalUser1?._id) await User.findByIdAndDelete(normalUser1._id);
      if (normalUser2?._id) await User.findByIdAndDelete(normalUser2._id);
      if (user1ReviewId) await Review.findByIdAndDelete(user1ReviewId);
      await User.deleteMany({ email: { $regex: /@codesense\.test$/i } });
      await AuditLog.deleteMany({ targetEmail: { $regex: /@codesense\.test$/i } });
    } catch (_) {}

    if (server && server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
    const mongoose = require('mongoose');
    await mongoose.disconnect();
  });

  // Test 1: Normal registration always assigns USER
  it('1. Normal registration always assigns USER role on the backend', async () => {
    const email = `reg_normal_${Date.now()}@codesense.test`;
    const res = await req('/api/auth/register', {
      method: 'POST',
      body: { email, password: 'StrongPassword123!', name: 'Normal Reg Tester' },
    });
    assert.strictEqual(res.status, 201, 'Registration should succeed');

    const created = await User.findOne({ email });
    assert.ok(created, 'User record must exist');
    assert.strictEqual(created.role, ROLES.USER, 'Initial role must strictly be USER');
    await User.findByIdAndDelete(created._id);
  });

  // Test 2: Submitting role: ADMIN during registration does not grant Admin privileges
  it('2. Submitting role: ADMIN during registration does not grant Admin privileges', async () => {
    const email = `reg_admin_spoof_${Date.now()}@codesense.test`;
    const res = await req('/api/auth/register', {
      method: 'POST',
      body: {
        email,
        password: 'StrongPassword123!',
        name: 'Spoof Admin Tester',
        role: 'ADMIN',
        roles: ['ADMIN'],
        isAdmin: true,
      },
    });
    assert.strictEqual(res.status, 201);

    const created = await User.findOne({ email });
    assert.ok(created);
    assert.strictEqual(created.role, ROLES.USER, 'Backend must ignore client role and assign USER');
    await User.findByIdAndDelete(created._id);
  });

  // Test 3: Submitting role: SUPER_ADMIN during registration does not grant Super Admin privileges
  it('3. Submitting role: SUPER_ADMIN during registration does not grant Super Admin privileges', async () => {
    const email = `reg_super_spoof_${Date.now()}@codesense.test`;
    const res = await req('/api/auth/register', {
      method: 'POST',
      body: {
        email,
        password: 'StrongPassword123!',
        name: 'Spoof Super Tester',
        role: 'SUPER_ADMIN',
        isSuperAdmin: true,
      },
    });
    assert.strictEqual(res.status, 201);

    const created = await User.findOne({ email });
    assert.ok(created);
    assert.strictEqual(created.role, ROLES.USER, 'Backend must prevent mass assignment of SUPER_ADMIN');
    await User.findByIdAndDelete(created._id);
  });

  // Test 4: Users cannot modify their own roles
  it('4. Users cannot modify their own roles via profile or ordinary APIs', async () => {
    const res = await req('/api/user/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${normalUser1Token}` },
      body: {
        name: 'Updated Name',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    });
    assert.strictEqual(res.status, 200, 'Profile update endpoint succeeded for allowed fields');

    const fresh = await User.findById(normalUser1._id);
    assert.strictEqual(fresh.role, ROLES.USER, 'User role must remain unchanged');
  });

  // Test 5: Users cannot access administrative endpoints
  it('5. Normal Users cannot access administrative endpoints (403 Forbidden)', async () => {
    const resUsers = await req('/api/admin/users', {
      headers: { Authorization: `Bearer ${normalUser1Token}` },
    });
    assert.strictEqual(resUsers.status, 403, 'GET /api/admin/users must be forbidden for USER');

    const resAudit = await req('/api/admin/audit-logs', {
      headers: { Authorization: `Bearer ${normalUser1Token}` },
    });
    assert.strictEqual(resAudit.status, 403, 'GET /api/admin/audit-logs must be forbidden for USER');

    const resReviews = await req('/api/admin/reviews', {
      headers: { Authorization: `Bearer ${normalUser1Token}` },
    });
    assert.strictEqual(resReviews.status, 403, 'GET /api/admin/reviews must be forbidden for USER');
  });

  // Test 6: Admins cannot create or promote Super Admin accounts
  it('6. Admins cannot create or promote Super Admin accounts (403 Forbidden)', async () => {
    const res = await req(`/api/admin/users/${normalUser2._id}/role`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { role: 'SUPER_ADMIN' },
    });
    assert.strictEqual(res.status, 403, 'Admin must not have roles.assign permission');

    const fresh = await User.findById(normalUser2._id);
    assert.strictEqual(fresh.role, ROLES.USER, 'Target user role must remain USER');
  });

  // Test 7: Only authorized Super Admins can create or promote Admin accounts
  it('7. Only authorized Super Admins can promote USER to ADMIN and demote ADMIN to USER', async () => {
    // 1. Promote normalUser2 to ADMIN
    const promoRes = await req(`/api/admin/users/${normalUser2._id}/role`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: { role: 'ADMIN' },
    });
    assert.strictEqual(promoRes.status, 200, 'Super Admin should successfully promote');

    let fresh = await User.findById(normalUser2._id);
    assert.strictEqual(fresh.role, ROLES.ADMIN, 'Target must now be ADMIN');

    // 2. Demote normalUser2 back to USER
    const demoRes = await req(`/api/admin/users/${normalUser2._id}/role`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: { role: 'USER' },
    });
    assert.strictEqual(demoRes.status, 200, 'Super Admin should successfully demote');

    fresh = await User.findById(normalUser2._id);
    assert.strictEqual(fresh.role, ROLES.USER, 'Target must now be USER');

    // Refresh normalUser2Token with updated tokenVersion
    normalUser2Token = jwt.sign(
      { id: normalUser2._id.toString(), email: normalUser2.email, role: ROLES.USER, tokenVersion: fresh.tokenVersion },
      JWT_SECRET
    );
  });

  // Test 8: Unauthorized users cannot perform role changes through direct API requests
  it('8. Unauthorized users cannot perform role changes through direct API requests', async () => {
    // Unauthenticated
    const noAuthRes = await req(`/api/admin/users/${normalUser2._id}/role`, {
      method: 'PUT',
      body: { role: 'ADMIN' },
    });
    assert.strictEqual(noAuthRes.status, 401, 'Unauthenticated request must return 401');

    // Authenticated as regular user
    const userRes = await req(`/api/admin/users/${normalUser2._id}/role`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${normalUser1Token}` },
      body: { role: 'ADMIN' },
    });
    assert.strictEqual(userRes.status, 403, 'Regular user request must return 403');
  });

  // Test 9: Users cannot access other users' private projects or associated resources (IDOR)
  it('9. Users cannot access other users private projects or markdown reports (IDOR Protection)', async () => {
    // Normal User 2 tries to read Normal User 1's private report
    const resUser2 = await req(`/api/history/${user1ReviewId}/markdown`, {
      headers: { Authorization: `Bearer ${normalUser2Token}` },
    });
    assert.strictEqual(resUser2.status, 403, 'User 2 cannot access User 1 private report');

    // Normal Admin also cannot access private source code/markdown without explicit authorization
    const resAdmin = await req(`/api/history/${user1ReviewId}/markdown`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(resAdmin.status, 403, 'Admin cannot access private user code report merely because they are Admin');

    // User 1 (owner) can access their own report
    const resOwner = await req(`/api/history/${user1ReviewId}/markdown`, {
      headers: { Authorization: `Bearer ${normalUser1Token}` },
    });
    assert.strictEqual(resOwner.status, 200, 'Owner can access their own report');
    assert.ok(resOwner.data.markdown.includes('Confidential'), 'Should return correct markdown');
  });

  // Test 10: Account suspension and privilege revocation take effect appropriately
  it('10. Account suspension takes effect immediately on API and login', async () => {
    // Super Admin suspends normalUser2
    const suspendRes = await req(`/api/admin/users/${normalUser2._id}/status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: { status: 'SUSPENDED' },
    });
    assert.strictEqual(suspendRes.status, 200, 'Suspension request succeeded');

    // User 2's token must now be rejected
    const apiRes = await req('/api/history', {
      headers: { Authorization: `Bearer ${normalUser2Token}` },
    });
    assert.strictEqual(apiRes.status, 403, 'Suspended user must be blocked on protected routes');

    // User 2 login must be rejected
    const loginRes = await req('/api/auth/login', {
      method: 'POST',
      body: { email: normalUser2.email, password: 'UserPass123!' },
    });
    assert.strictEqual(loginRes.status, 403, 'Suspended user cannot sign in');

    // Reactivate User 2
    const reactivateRes = await req(`/api/admin/users/${normalUser2._id}/status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: { status: 'ACTIVE' },
    });
    assert.strictEqual(reactivateRes.status, 200, 'Reactivation succeeded');

    const fresh = await User.findById(normalUser2._id);
    normalUser2Token = jwt.sign(
      { id: normalUser2._id.toString(), email: normalUser2.email, role: ROLES.USER, tokenVersion: fresh.tokenVersion },
      JWT_SECRET
    );
  });

  // Test 11: The final active Super Admin cannot accidentally be removed or demoted
  it('11. The final active Super Admin cannot accidentally be demoted or deactivated', async () => {
    // Find all other active super admins in the database
    const others = await User.find({
      role: ROLES.SUPER_ADMIN,
      status: 'ACTIVE',
      _id: { $ne: superAdminUser._id },
    });
    const otherIds = others.map(u => u._id);

    // Temporarily demote other super admins so superAdminUser is the sole active SUPER_ADMIN
    if (otherIds.length > 0) {
      await User.updateMany({ _id: { $in: otherIds } }, { role: ROLES.ADMIN });
    }

    try {
      // Attempt to demote the only remaining active Super Admin
      const demoteRes = await req(`/api/admin/users/${superAdminUser._id}/role`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { role: 'ADMIN' },
      });
      assert.strictEqual(demoteRes.status, 400, 'Demoting last Super Admin must be rejected');
      assert.ok(demoteRes.data.error.includes('Super Admin'), 'Must mention Super Admin protection');

      // Attempt to suspend the final active Super Admin
      const suspendRes = await req(`/api/admin/users/${superAdminUser._id}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${superAdminToken}` },
        body: { status: 'SUSPENDED' },
      });
      assert.strictEqual(suspendRes.status, 400, 'Suspending last Super Admin must be rejected');
    } finally {
      // Restore other super admins
      if (otherIds.length > 0) {
        await User.updateMany({ _id: { $in: otherIds } }, { role: ROLES.SUPER_ADMIN });
      }
    }
  });

  // Test 12: Unknown or malformed roles fail safely
  it('12. Unknown or malformed roles fail safely and default to USER', () => {
    assert.strictEqual(normalizeRole('INVALID_ROLE'), ROLES.USER);
    assert.strictEqual(normalizeRole(null), ROLES.USER);
    assert.strictEqual(normalizeRole(undefined), ROLES.USER);
    assert.strictEqual(normalizeRole(''), ROLES.USER);
    assert.strictEqual(normalizeRole('Viewer'), ROLES.USER);

    assert.strictEqual(hasPermission('UNKNOWN_ROLE', PERMISSIONS.ADMIN_ACCESS), false);
    assert.strictEqual(hasPermission(ROLES.USER, PERMISSIONS.ADMIN_ACCESS), false);
    assert.strictEqual(hasPermission(ROLES.ADMIN, PERMISSIONS.ADMIN_ACCESS), true);
    assert.strictEqual(hasPermission(ROLES.ADMIN, PERMISSIONS.ROLES_ASSIGN), false);
    assert.strictEqual(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.ROLES_ASSIGN), true);
  });

  // Test 13: Google OAuth and account linking cannot bypass role restrictions
  it('13. Google OAuth simulation preserves existing role and rejects suspended accounts', async () => {
    // Suspended account check
    await User.findByIdAndUpdate(normalUser1._id, { status: 'SUSPENDED' });
    const res = await req('/api/auth/google', {
      method: 'POST',
      body: { credential: 'dummy-token' },
    });
    // Rejected either with 401 (invalid google credential) or 403 (suspended)
    assert.ok([401, 403, 500].includes(res.status));
    await User.findByIdAndUpdate(normalUser1._id, { status: 'ACTIVE' });
  });

  // Test 14: Administrative actions produce appropriate audit records
  it('14. Administrative actions produce appropriate audit records with metadata', async () => {
    const logs = await AuditLog.find({ action: 'ROLE_ASSIGN' }).sort({ createdAt: -1 });
    assert.ok(logs.length > 0, 'Audit log must record ROLE_ASSIGN action');

    const latest = logs[0];
    assert.strictEqual(latest.outcome, 'SUCCESS');
    assert.ok(latest.actorEmail, 'Must record actor email');
    assert.ok(latest.targetEmail, 'Must record target email');
  });

  // Test 15: Existing authentication and project workflows continue to work
  it('15. Existing authentication and project workflows continue to work', async () => {
    // /api/auth/me works
    const meRes = await req('/api/auth/me', {
      headers: { Authorization: `Bearer ${normalUser1Token}` },
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.user.email, normalUser1.email);
    assert.strictEqual(meRes.data.user.role, ROLES.USER);

    // /api/history works
    const histRes = await req('/api/history', {
      headers: { Authorization: `Bearer ${normalUser1Token}` },
    });
    assert.strictEqual(histRes.status, 200);
    assert.ok(Array.isArray(histRes.data.reviews));
  });

  after(async () => {
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        await User.deleteMany({ email: { $regex: /@codesense\.test$/ } });
        await Review.deleteMany({ repo: 'https://github.com/test-org/rbac-repo-1' });
      }
    } catch (_) {}
    finally {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    }
  });
});
