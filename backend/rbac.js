/**
 * CodeSense Role-Based Access Control (RBAC) Module
 * Enforces strict 3-role hierarchy: SUPER_ADMIN > ADMIN > USER
 */

const ROLES = Object.freeze({
  USER: 'USER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
});

const ROLE_LEVELS = Object.freeze({
  [ROLES.USER]: 1,
  [ROLES.ADMIN]: 2,
  [ROLES.SUPER_ADMIN]: 3,
});

const PERMISSIONS = Object.freeze({
  ADMIN_ACCESS: 'admin.access',
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',             // Suspend / reactivate / delete users within authorized scope
  ROLES_ASSIGN: 'roles.assign',             // Promote USER to ADMIN, demote ADMIN to USER (SUPER_ADMIN only)
  AUDIT_READ: 'audit.read',                 // View security audit logs
  PLATFORM_SETTINGS: 'platform.settings.manage', // Manage platform-level configurations
});

// Role-to-Permissions Matrix
const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.USER]: Object.freeze([]),
  [ROLES.ADMIN]: Object.freeze([
    PERMISSIONS.ADMIN_ACCESS,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.AUDIT_READ,
  ]),
  [ROLES.SUPER_ADMIN]: Object.freeze([
    PERMISSIONS.ADMIN_ACCESS,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.ROLES_ASSIGN,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.PLATFORM_SETTINGS,
  ]),
});

/**
 * Normalizes input role string to one of the 3 canonical roles.
 * Unknown, missing, or malformed inputs safely default to 'USER'.
 */
function normalizeRole(role) {
  if (typeof role !== 'string') return ROLES.USER;
  const upper = role.trim().toUpperCase();
  if (upper === ROLES.SUPER_ADMIN || upper === 'SUPERADMIN') return ROLES.SUPER_ADMIN;
  if (upper === ROLES.ADMIN) return ROLES.ADMIN;
  if (upper === ROLES.USER) return ROLES.USER;
  return ROLES.USER;
}

/**
 * Checks whether a given role holds a specific permission.
 */
function hasPermission(role, permission) {
  const norm = normalizeRole(role);
  const perms = ROLE_PERMISSIONS[norm] || [];
  return perms.includes(permission);
}

/**
 * Compares two roles according to the hierarchy SUPER_ADMIN > ADMIN > USER
 * Returns > 0 if roleA is higher, < 0 if roleB is higher, 0 if equal.
 */
function compareRoles(roleA, roleB) {
  const levelA = ROLE_LEVELS[normalizeRole(roleA)] || 0;
  const levelB = ROLE_LEVELS[normalizeRole(roleB)] || 0;
  return levelA - levelB;
}

/**
 * Validates if actor can manage the target account's status/lifecycle.
 * Rule: Actors cannot manage accounts with equal or higher roles.
 */
function canManageTargetAccount(actorRole, targetRole) {
  const actorNorm = normalizeRole(actorRole);
  const targetNorm = normalizeRole(targetRole);

  if (actorNorm === ROLES.SUPER_ADMIN) {
    // Super Admin can manage Admins and Users (cannot demote/suspend the last Super Admin, checked separately)
    return true;
  }
  if (actorNorm === ROLES.ADMIN) {
    // Admin can ONLY manage normal USER accounts
    return targetNorm === ROLES.USER;
  }
  return false;
}

/**
 * Validates if actor can assign a role to a target.
 * Rule: Only SUPER_ADMIN can assign/promote/demote roles.
 * Permitted role changes via UI: USER <-> ADMIN.
 */
function canAssignRole(actorRole, targetCurrentRole, desiredRole) {
  const actorNorm = normalizeRole(actorRole);
  const targetNorm = normalizeRole(targetCurrentRole);
  const desiredNorm = normalizeRole(desiredRole);

  // Only SUPER_ADMIN can assign roles
  if (actorNorm !== ROLES.SUPER_ADMIN) return false;

  // Cannot assign unknown or non-whitelisted roles
  if (![ROLES.USER, ROLES.ADMIN].includes(desiredNorm)) return false;

  // Cannot modify other Super Admins through ordinary role endpoints
  if (targetNorm === ROLES.SUPER_ADMIN && desiredNorm !== ROLES.SUPER_ADMIN) {
    return false;
  }

  return true;
}

module.exports = {
  ROLES,
  ROLE_LEVELS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  normalizeRole,
  hasPermission,
  compareRoles,
  canManageTargetAccount,
  canAssignRole,
};
