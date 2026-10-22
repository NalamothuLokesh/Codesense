/**
 * CodeSense RBAC Migration Script
 * Migrates existing user accounts to uppercase canonical roles ('USER', 'ADMIN', 'SUPER_ADMIN')
 * and initializes 'status: ACTIVE' and 'tokenVersion: 0' without unintentionally granting privileges.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { connectDB, User, AuditLog } = require('../db');
const { ROLES, normalizeRole } = require('../rbac');

async function runMigration() {
  console.log('[migration] Starting RBAC data migration...');
  await connectDB();

  const users = await User.find({});
  console.log(`[migration] Found ${users.length} existing user record(s).`);

  let updatedCount = 0;
  for (const user of users) {
    let modified = false;
    const oldRole = user.role;
    const newRole = normalizeRole(oldRole);

    if (oldRole !== newRole) {
      user.role = newRole;
      modified = true;
    }

    if (!user.status) {
      user.status = 'ACTIVE';
      modified = true;
    }

    if (typeof user.tokenVersion !== 'number') {
      user.tokenVersion = 0;
      modified = true;
    }

    if (modified) {
      await user.save();
      updatedCount++;
      console.log(`[migration] Updated user ${user.email}: role [${oldRole} -> ${newRole}], status [${user.status}]`);
    }
  }

  // Create audit log for migration
  await AuditLog.create({
    action: 'RBAC_MIGRATION',
    details: { totalUsers: users.length, updatedUsers: updatedCount },
    outcome: 'SUCCESS',
  });

  console.log(`[migration] Migration completed successfully. ${updatedCount} user(s) updated.`);
  await mongoose.disconnect();
}

runMigration().catch(err => {
  console.error('[migration] Error running migration:', err);
  process.exit(1);
});
