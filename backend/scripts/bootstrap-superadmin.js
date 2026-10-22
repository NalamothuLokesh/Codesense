/**
 * CodeSense — Secure Initial Super Admin Bootstrap CLI
 *
 * This server-side bootstrap command promotes a verified existing account to SUPER_ADMIN.
 * Security safeguards:
 * 1. Closes automatically once an active SUPER_ADMIN exists in the database.
 * 2. Requires target account to already exist (prevents arbitrary injection).
 * 3. Enforces email verification.
 * 4. Increments tokenVersion to ensure immediate privilege synchronization.
 * 5. Records a secure immutable audit log entry.
 *
 * Usage:
 *   node backend/scripts/bootstrap-superadmin.js <email> [--force-verify]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { connectDB, User, AuditLog } = require('../db');
const { ROLES } = require('../rbac');

async function bootstrap() {
  const args = process.argv.slice(2);
  const emailArg = args.find(a => !a.startsWith('--'));
  const forceVerify = args.includes('--force-verify');

  if (!emailArg) {
    console.error('Error: Target account email is required.\nUsage: node scripts/bootstrap-superadmin.js <email> [--force-verify]');
    process.exit(1);
  }

  const cleanEmail = emailArg.trim().toLowerCase();
  await connectDB();

  // Safeguard 1: Prevent repeated execution if an active Super Admin already exists
  const existingSuperAdmin = await User.findOne({ role: ROLES.SUPER_ADMIN, status: 'ACTIVE' });
  if (existingSuperAdmin) {
    console.error(`\n[BOOTSTRAP SAFEGUARD] Access denied.`);
    console.error(`An active Super Admin (${existingSuperAdmin.email}) is already established.`);
    console.error(`The one-time bootstrap mechanism is permanently disabled.`);
    console.error(`To manage administrator privileges, sign in with the Super Admin account via the CodeSense Admin Portal.\n`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Safeguard 2: Require the account to already exist in the system
  const user = await User.findOne({ email: cleanEmail });
  if (!user) {
    console.error(`\n[BOOTSTRAP ERROR] Account with email "${cleanEmail}" does not exist.`);
    console.error(`The account must first be registered through normal user registration before bootstrap promotion.\n`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Safeguard 3: Require email verification
  if (!user.emailVerified) {
    if (forceVerify) {
      console.log(`[bootstrap] Operator explicitly authorized verification for ${cleanEmail}.`);
      user.emailVerified = true;
      user.verificationCodeHash = null;
      user.verificationCodeExpiresAt = null;
    } else {
      console.error(`\n[BOOTSTRAP ERROR] Account "${cleanEmail}" is pending email verification.`);
      console.error(`Complete email OTP verification first, or re-run with --force-verify to confirm trusted operator intent.\n`);
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  // Promote to SUPER_ADMIN
  const previousRole = user.role;
  user.role = ROLES.SUPER_ADMIN;
  user.status = 'ACTIVE';
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  // Record audit log entry
  await AuditLog.create({
    action: 'SUPER_ADMIN_BOOTSTRAP',
    actorEmail: 'SERVER_OPERATOR',
    actorRole: 'SYSTEM_CLI',
    targetId: user._id,
    targetEmail: user.email,
    details: {
      previousRole,
      newRole: ROLES.SUPER_ADMIN,
      forceVerifyApplied: forceVerify,
    },
    outcome: 'SUCCESS',
  });

  console.log(`\n======================================================`);
  console.log(`  CodeSense Initial Super Admin Bootstrap Complete  `);
  console.log(`======================================================`);
  console.log(`Account Email : ${user.email}`);
  console.log(`Account Name  : ${user.name}`);
  console.log(`Assigned Role : ${user.role}`);
  console.log(`Account Status: ${user.status}`);
  console.log(`Audit Record  : Logged (SUPER_ADMIN_BOOTSTRAP)`);
  console.log(`Safeguard     : Bootstrap is now closed for future executions.`);
  console.log(`======================================================\n`);

  await mongoose.disconnect();
}

bootstrap().catch(err => {
  console.error('[bootstrap fatal error]', err);
  process.exit(1);
});
