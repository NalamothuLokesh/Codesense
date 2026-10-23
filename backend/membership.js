/**
 * CodeSense Membership & Subscription Management Module
 *
 * Implements:
 * 1. Definitive 3-tier membership plan specifications (FREE, PRO, ENTERPRISE)
 * 2. Multi-resource quota checking & atomic tracking (Reviews, AI Codebase Chat)
 * 3. Subscription lifecycle management (ACTIVE, PENDING, CANCELLED, EXPIRED, SUPERSEDED)
 * 4. Repurchase / extension handling (preserves remaining paid days)
 * 5. Cashfree Payment Gateway integration (Payment Links API, HMAC-SHA256 webhook verification)
 * 6. RBAC-Membership privilege isolation (Paid tier never escalates administrative roles)
 */

const crypto = require('crypto');
const { Subscription, ChatUsage, User, Review } = require('./db');

// ── Plans Specification ───────────────────────────────────────────────────────
const PLANS = Object.freeze({
  FREE: {
    id: 'FREE',
    name: 'Free',
    badge: 'Developer',
    tagline: 'Essential code intelligence for individual developers',
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'INR',
    pricePaiseMonthly: 0,
    pricePaiseYearly: 0,
    limits: {
      reviewsPerMonth: 3,
      chatQueriesPerMonth: 20,
      concurrentReviews: 1,
      maxHistoryRetention: 10,
    },
    features: [
      '3 repository reviews / month',
      '20 AI codebase chat queries / month',
      '1 concurrent analysis job',
      'Interactive Mermaid architecture diagrams',
      'Markdown review export',
      'Standard queue processing',
      'Community support',
    ],
  },
  PRO: {
    id: 'PRO',
    name: 'Pro',
    badge: 'Professional',
    tagline: 'High-throughput code review & deep architecture insights',
    priceMonthly: 499,
    priceYearly: 4790, // ~20% discount (₹399/mo equivalent)
    currency: 'INR',
    pricePaiseMonthly: 49900,
    pricePaiseYearly: 479000,
    limits: {
      reviewsPerMonth: 50,
      chatQueriesPerMonth: 500,
      concurrentReviews: 3,
      maxHistoryRetention: -1, // Unlimited
    },
    features: [
      '50 repository reviews / month',
      '500 AI codebase chat queries / month',
      '3 concurrent analysis jobs',
      'Unlimited review history retention',
      'High-priority LLM processing',
      'Mermaid SVG / PDF printable exports',
      'Email alerts & issue summaries',
      'Standard email support',
    ],
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    badge: 'Team & Organization',
    tagline: 'Unlimited intelligence and governance for engineering teams',
    priceMonthly: 1999,
    priceYearly: 19190, // ~20% discount
    currency: 'INR',
    pricePaiseMonthly: 199900,
    pricePaiseYearly: 1919000,
    limits: {
      reviewsPerMonth: -1, // Unlimited
      chatQueriesPerMonth: -1, // Unlimited
      concurrentReviews: 10,
      maxHistoryRetention: -1, // Unlimited
    },
    features: [
      'Unlimited repository reviews',
      'Unlimited AI codebase chat queries',
      '10 concurrent analysis jobs',
      'Dedicated high-throughput queue',
      'Custom architecture diagram exports',
      'Centralized administrative controls',
      'Security audit log access',
      'Priority 24/7 technical support',
    ],
  },
});

function normalizePlan(plan) {
  if (typeof plan !== 'string') return 'FREE';
  const upper = plan.trim().toUpperCase();
  if (PLANS[upper]) return upper;
  return 'FREE';
}

function getCurrentMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function getCurrentYearMonth() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}

// ── Cashfree Gateway Helper ───────────────────────────────────────────────────
function getCashfreeConfig() {
  if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY || process.env.CASHFREE_APP_ID === 'your_cashfree_app_id') {
    try {
      require('dotenv').config({ path: require('path').resolve(__dirname, '.env'), override: true });
    } catch (_) {}
  }

  const appId = (process.env.CASHFREE_APP_ID || '').trim();
  const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();
  const envRaw = (process.env.CASHFREE_ENVIRONMENT || process.env.CASHFREE_ENV || 'sandbox').trim().toLowerCase();
  const isProd = envRaw === 'production' || envRaw === 'prod';
  const environment = isProd ? 'production' : 'sandbox';
  const webhookSecret = (process.env.CASHFREE_WEBHOOK_SECRET || secretKey || '').trim();

  const baseUrl = isProd
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

  const isConfigured = Boolean(
    appId &&
    secretKey &&
    !appId.includes('your_cashfree') &&
    !secretKey.includes('your_cashfree')
  );

  return { appId, secretKey, environment, webhookSecret, baseUrl, isConfigured };
}

function verifyCashfreeWebhookSignature(rawPayload, signature) {
  const { webhookSecret, isConfigured } = getCashfreeConfig();
  if (!isConfigured || !webhookSecret) {
    // If not configured, we do not authenticate fake webhooks
    return false;
  }
  if (!signature) return false;

  try {
    const computed = crypto
      .createHmac('sha256', webhookSecret)
      .update(typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload))
      .digest('hex');
    const bufA = Buffer.from(computed, 'utf8');
    const bufB = Buffer.from(signature, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (err) {
    console.error('[Cashfree webhook verification error]', err.message);
    return false;
  }
}

async function createCashfreePaymentLink({ user, planId, billingInterval, returnUrl, notifyUrl }) {
  const config = getCashfreeConfig();
  if (!config.isConfigured) {
    throw new Error('Cashfree payment gateway is not configured (missing CASHFREE_APP_ID or CASHFREE_SECRET_KEY in backend/.env).');
  }

  const plan = PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const isYearly = billingInterval === 'yearly';
  const amountPaise = isYearly ? plan.pricePaiseYearly : plan.pricePaiseMonthly;
  const amountRupees = amountPaise / 100.0;

  const linkId = `order_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  function cleanUrl(val, fallback) {
    const raw = (val || fallback).trim().replace(/^['"]+|['"]+$/g, '');
    const match = raw.match(/^[A-Za-z0-9_]+\s*=\s*(https?:\/\/.*)$/i);
    return (match ? match[1] : raw).trim().replace(/\/+$/, '');
  }
  const frontendBase = cleanUrl(process.env.FRONTEND_URL, 'http://localhost:5173');
  const backendBase = cleanUrl(process.env.BACKEND_URL, 'http://localhost:4000');

  const effectiveReturnUrl = (returnUrl || `${frontendBase}/pricing`);
  const separator = effectiveReturnUrl.includes('?') ? '&' : '?';
  const finalReturnUrl = effectiveReturnUrl.includes('order_id=')
    ? effectiveReturnUrl
    : `${effectiveReturnUrl}${separator}order_id=${linkId}`;

  const payload = {
      link_id: linkId,
      link_amount: amountRupees,
      link_currency: 'INR',
      link_purpose: `CodeSense ${plan.name} Plan (${isYearly ? 'Annual' : 'Monthly'})`,
      customer_details: {
        customer_email: user.email,
        customer_name: user.name || 'CodeSense Developer',
        customer_phone: '9999999999', // Default compliant placeholder for checkout
      },
      link_notify: {
        send_sms: false,
        send_email: false,
      },
      link_meta: {
        return_url: finalReturnUrl,
        notify_url: notifyUrl || `${backendBase}/api/membership/webhook`,
      },
    };

    const response = await fetch(`${config.baseUrl}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': config.appId,
        'x-client-secret': config.secretKey,
        'x-api-version': '2023-08-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.link_url) {
      const errorMsg = data.message || `Cashfree API returned HTTP ${response.status}`;
      throw new Error(`Failed to create Cashfree payment link: ${errorMsg}`);
    }

    return {
      orderId: linkId,
      paymentLink: data.link_url,
      amount: amountPaise,
      currency: 'INR',
    };
  }

  async function fetchCashfreeOrderStatus(orderId) {
    const config = getCashfreeConfig();
    if (!config.isConfigured || !orderId) return null;

    try {
      // 1. First check /links/{id}
      let res = await fetch(`${config.baseUrl}/links/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        headers: {
          'x-client-id': config.appId,
          'x-client-secret': config.secretKey,
          'x-api-version': '2023-08-01',
        },
        signal: AbortSignal.timeout(3500),
      });

      if (res.ok) {
        const data = await res.json();
        return data.link_status || data.order_status || null; // 'PAID', 'ACTIVE', etc.
      }

      // 2. Fallback to /orders/{id}
      res = await fetch(`${config.baseUrl}/orders/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        headers: {
          'x-client-id': config.appId,
          'x-client-secret': config.secretKey,
          'x-api-version': '2023-08-01',
        },
        signal: AbortSignal.timeout(3500),
      });

      if (res.ok) {
        const data = await res.json();
        return data.order_status || null;
      }

      return null;
    } catch (err) {
      console.error('[Cashfree order status check error]', err.message);
      return null;
    }
  }

// ── Active Subscription Resolver ──────────────────────────────────────────────
async function getUserActiveSubscription(userId, userRole) {
  // Platform Operators (SUPER_ADMIN and ADMIN) have unlimited operational access
  if (userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') {
    return {
      plan: 'ENTERPRISE',
      planDetails: PLANS.ENTERPRISE,
      status: 'ACTIVE',
      isExemptRole: true,
      billingInterval: 'yearly',
      amount: 0,
      currency: 'INR',
      expiresAt: null,
      cancelledAt: null,
      gatewayOrderId: null,
      subscriptionId: null,
    };
  }

  if (!userId) {
    return {
      plan: 'FREE',
      planDetails: PLANS.FREE,
      status: 'NONE',
      isExemptRole: false,
      billingInterval: 'monthly',
      amount: 0,
      currency: 'INR',
      expiresAt: null,
      cancelledAt: null,
      gatewayOrderId: null,
      subscriptionId: null,
    };
  }

  try {
    const sub = await Subscription.findOne({
      userId,
      status: { $in: ['ACTIVE', 'CANCELLED'] },
    }).sort({ createdAt: -1 });

    if (sub) {
      // Check for expiration
      if (sub.expiresAt && new Date(sub.expiresAt) <= new Date()) {
        sub.status = 'EXPIRED';
        await sub.save();
        await User.findByIdAndUpdate(userId, { membershipPlan: 'FREE' });
      } else {
        const planKey = normalizePlan(sub.plan);
        return {
          plan: planKey,
          planDetails: PLANS[planKey] || PLANS.FREE,
          status: sub.status,
          isExemptRole: false,
          billingInterval: sub.billingInterval || 'monthly',
          amount: sub.amount || 0,
          currency: sub.currency || 'INR',
          expiresAt: sub.expiresAt,
          cancelledAt: sub.cancelledAt,
          gatewayOrderId: sub.gatewayOrderId,
          subscriptionId: sub._id.toString(),
        };
      }
    }



    // Also check direct User.membershipPlan (e.g. assigned via Admin Panel)
    const userDoc = await User.findById(userId).select('membershipPlan');
    if (userDoc?.membershipPlan && userDoc.membershipPlan !== 'FREE') {
      const planKey = normalizePlan(userDoc.membershipPlan);
      return {
        plan: planKey,
        planDetails: PLANS[planKey] || PLANS.FREE,
        status: 'ACTIVE',
        isExemptRole: false,
        billingInterval: 'monthly',
        amount: 0,
        currency: 'INR',
        expiresAt: null,
        cancelledAt: null,
        gatewayOrderId: null,
        subscriptionId: null,
      };
    }
  } catch (err) {
    console.error('[getUserActiveSubscription error]', err.message);
  }

  return {
    plan: 'FREE',
    planDetails: PLANS.FREE,
    status: 'NONE',
    isExemptRole: false,
    billingInterval: 'monthly',
    amount: 0,
    currency: 'INR',
    expiresAt: null,
    cancelledAt: null,
    gatewayOrderId: null,
    subscriptionId: null,
  };
}

// ── Quota & Usage Stats ───────────────────────────────────────────────────────
async function getUserUsageStats(userId, userRole) {
  const sub = await getUserActiveSubscription(userId, userRole);
  const monthStart = getCurrentMonthStart();
  const yearMonth = getCurrentYearMonth();

  let reviewsThisMonth = 0;
  let chatThisMonth = 0;

  if (userId) {
    try {
      reviewsThisMonth = await Review.countDocuments({
        userId,
        createdAt: { $gte: monthStart },
      });
    } catch (err) {
      console.error('[count reviews error]', err.message);
    }

    try {
      const usageDoc = await ChatUsage.findOne({ userId, yearMonth });
      chatThisMonth = usageDoc?.count || 0;
    } catch (err) {
      console.error('[count chat queries error]', err.message);
    }
  }

  const reviewLimit = sub.planDetails.limits.reviewsPerMonth;
  const reviewRemaining = reviewLimit === -1 ? -1 : Math.max(0, reviewLimit - reviewsThisMonth);

  const chatLimit = sub.planDetails.limits.chatQueriesPerMonth;
  const chatRemaining = chatLimit === -1 ? -1 : Math.max(0, chatLimit - chatThisMonth);

  return {
    plan: sub.plan,
    planDetails: sub.planDetails,
    status: sub.status,
    isExemptRole: sub.isExemptRole,
    expiresAt: sub.expiresAt,
    cancelledAt: sub.cancelledAt,
    billingInterval: sub.billingInterval,
    amount: sub.amount,
    currency: sub.currency,
    gatewayOrderId: sub.gatewayOrderId,
    reviews: {
      used: reviewsThisMonth,
      limit: reviewLimit,
      remaining: reviewRemaining,
      percentage: reviewLimit > 0 ? Math.min(100, Math.round((reviewsThisMonth / reviewLimit) * 100)) : 0,
    },
    chat: {
      used: chatThisMonth,
      limit: chatLimit,
      remaining: chatRemaining,
      percentage: chatLimit > 0 ? Math.min(100, Math.round((chatThisMonth / chatLimit) * 100)) : 0,
    },
    concurrentLimit: sub.planDetails.limits.concurrentReviews,
    historyLimit: sub.planDetails.limits.maxHistoryRetention,
  };
}

// ── Quota Checks (Server-Side Hard Enforcement) ──────────────────────────────
async function checkReviewQuota(userId, userRole) {
  if (userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') {
    return { allowed: true, remaining: -1, limit: -1, used: 0 };
  }

  if (!userId) {
    return {
      allowed: false,
      requireLogin: true,
      error: 'Sign in to run repository reviews under your monthly allowance.',
      code: 'AUTH_REQUIRED',
    };
  }

  const stats = await getUserUsageStats(userId, userRole);
  if (stats.reviews.limit !== -1 && stats.reviews.used >= stats.reviews.limit) {
    return {
      allowed: false,
      limit: stats.reviews.limit,
      used: stats.reviews.used,
      remaining: 0,
      plan: stats.plan,
      error: `Monthly repository review quota reached for your ${stats.plan} plan (${stats.reviews.used}/${stats.reviews.limit} used). Upgrade to Pro for 50 reviews/month or Enterprise for unlimited reviews.`,
      code: 'QUOTA_EXCEEDED',
    };
  }

  return {
    allowed: true,
    limit: stats.reviews.limit,
    used: stats.reviews.used,
    remaining: stats.reviews.remaining,
  };
}

async function checkChatQuota(userId, userRole) {
  if (userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') {
    return { allowed: true, remaining: -1, limit: -1, used: 0 };
  }

  if (!userId) {
    return {
      allowed: false,
      requireLogin: true,
      error: 'Authentication required to use AI Codebase Chat.',
      code: 'AUTH_REQUIRED',
    };
  }

  const stats = await getUserUsageStats(userId, userRole);
  if (stats.chat.limit !== -1 && stats.chat.used >= stats.chat.limit) {
    return {
      allowed: false,
      limit: stats.chat.limit,
      used: stats.chat.used,
      remaining: 0,
      plan: stats.plan,
      error: `Monthly AI Codebase Chat query quota reached (${stats.chat.used}/${stats.chat.limit} queries). Upgrade your plan for higher or unlimited conversational intelligence.`,
      code: 'CHAT_QUOTA_EXCEEDED',
    };
  }

  return {
    allowed: true,
    limit: stats.chat.limit,
    used: stats.chat.used,
    remaining: stats.chat.remaining,
  };
}

async function recordChatUsage(userId) {
  if (!userId) return 0;
  const yearMonth = getCurrentYearMonth();
  try {
    const doc = await ChatUsage.findOneAndUpdate(
      { userId, yearMonth },
      { $inc: { count: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return doc.count;
  } catch (err) {
    console.error('[recordChatUsage error]', err.message);
    return 0;
  }
}

// ── Subscription State Transitions ───────────────────────────────────────────
/**
 * Activates a subscription following reference project's extension pattern:
 * If user already holds an ACTIVE subscription, the new one begins at old expiresAt
 * (extending it by billing interval) and marks the old one SUPERSEDED.
 */
async function activateSubscription({
  userId,
  plan,
  billingInterval = 'monthly',
  amount = 0,
  currency = 'INR',
  gateway = 'none',
  gatewayOrderId = null,
  gatewayPaymentId = null,
}) {
  const normPlan = normalizePlan(plan);
  const now = new Date();

  // Strict idempotency guard: If this gateway order was already activated, return existing active record
  if (gatewayOrderId) {
    const alreadyActive = await Subscription.findOne({
      gatewayOrderId,
      status: 'ACTIVE',
    });
    if (alreadyActive) {
      return alreadyActive;
    }
  }

  // Check for existing ACTIVE subscription to extend
  const existingActive = await Subscription.findOne({
    userId,
    status: 'ACTIVE',
    expiresAt: { $gt: now },
  }).sort({ createdAt: -1 });

  let startDate = now;
  if (existingActive) {
    startDate = new Date(existingActive.expiresAt);
    existingActive.status = 'SUPERSEDED';
    await existingActive.save();
  }

  const expiresDate = new Date(startDate);
  if (billingInterval === 'yearly') {
    expiresDate.setFullYear(expiresDate.getFullYear() + 1);
  } else {
    expiresDate.setMonth(expiresDate.getMonth() + 1);
  }

  const sub = await Subscription.create({
    userId,
    plan: normPlan,
    status: 'ACTIVE',
    billingInterval,
    amount,
    currency,
    gateway,
    gatewayOrderId,
    gatewayPaymentId,
    startedAt: startDate,
    expiresAt: expiresDate,
    cancelledAt: null,
  });

  // Fast denormalized lookup on User
  await User.findByIdAndUpdate(userId, { membershipPlan: normPlan });

  return sub;
}

async function cancelSubscription(userId) {
  const sub = await Subscription.findOne({
    userId,
    status: 'ACTIVE',
  }).sort({ createdAt: -1 });

  if (!sub) {
    return { success: false, message: 'No active subscription found to cancel.' };
  }

  sub.status = 'CANCELLED';
  sub.cancelledAt = new Date();
  await sub.save();

  return {
    success: true,
    expiresAt: sub.expiresAt,
    message: `Subscription successfully cancelled. Paid access remains active until ${sub.expiresAt ? sub.expiresAt.toISOString().split('T')[0] : 'end of billing period'}.`,
  };
}

module.exports = {
  PLANS,
  normalizePlan,
  getCurrentMonthStart,
  getCurrentYearMonth,
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
};
