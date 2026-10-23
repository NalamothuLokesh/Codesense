/**
 * CodeSense — Transactional Email Service
 * Handles sending verification codes & security notifications.
 */
const nodemailer = require('nodemailer');

const TEST_DOMAINS = [
  'memtest.com',
  'codesense.test',
  'membership.test',
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'test.org',
  'dummy.com',
  'localhost',
  'invalid',
];

const RESERVED_TLDS = ['.test', '.example', '.invalid', '.localhost', '.local'];

/**
 * Determine whether a recipient email address belongs to a test, mock, or reserved domain.
 * Real transactional emails should NEVER be dispatched to test fixtures.
 */
function isTestRecipient(email) {
  if (!email || typeof email !== 'string') return true;
  const trimmed = email.trim().toLowerCase();
  const parts = trimmed.split('@');
  if (parts.length !== 2) return true;
  const [user, domain] = parts;
  if (!user || !domain) return true;

  // Check RFC 2606 / RFC 6761 reserved TLDs
  if (RESERVED_TLDS.some(tld => domain.endsWith(tld))) return true;

  // Check explicit test / mock domain list
  if (TEST_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) return true;

  // Block any domain containing test, mock, dummy, or fake unless it is an established public provider
  if (/(test|mock|dummy|fake|example)/i.test(domain)) {
    return true;
  }

  // Common automated test username patterns must ALWAYS be suppressed, regardless of domain
  if (/^(test_|mock_|dummy_|fake_|sample_|temp_|pro_dev|free_dev|admin_mem|superadmin_mem|testuser)/i.test(user)) {
    return true;
  }

  // Basic RFC 5322 sanity check on recipient syntax
  if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
    return true;
  }

  return false;
}

// Check if SMTP credentials are provided in environment
function isConfigured() {
  // Prevent any outbound email in test mode, CI, or when explicitly disabled
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.DISABLE_EMAIL === 'true' ||
    process.env.CI === 'true'
  ) {
    return false;
  }
  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const user = process.env.EMAIL_USERNAME || process.env.SMTP_USER;
  const pass = process.env.EMAIL_PASSWORD || process.env.SMTP_PASS;
  return Boolean(host && user && pass);
}

function getTransporter() {
  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 587);
  const secure = process.env.EMAIL_SECURE === 'true' || port === 465;
  const user = process.env.EMAIL_USERNAME || process.env.SMTP_USER;
  const pass = process.env.EMAIL_PASSWORD || process.env.SMTP_PASS;

  // Enforce strict TLS certificate verification by default (P1 Security Hardening).
  // Insecure / self-signed TLS certificates are strictly prohibited in production and require explicit opt-in in development.
  const allowInsecureTls = process.env.NODE_ENV !== 'production' &&
    (process.env.ALLOW_INSECURE_SMTP_CERTS === 'true' || process.env.ALLOW_SELF_SIGNED_CERTS === 'true');

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 5000,
    tls: {
      rejectUnauthorized: !allowInsecureTls,
    },
  });
}

/**
 * Send 6-digit verification code to user
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} [options.name] - User's name
 * @param {string} options.code - 6-digit verification PIN
 */
async function sendVerificationEmail({ to, name, code }) {
  const displayName = name ? name.trim() : 'there';
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'CodeSense <no-reply@codesense.dev>';
  const subject = 'Your CodeSense verification code';

  const text = `Hello ${displayName},

Your CodeSense verification code is:

${code}

This code expires in 10 minutes.

If you did not request this code, you can safely ignore this email.

— CodeSense`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your CodeSense verification code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e6edf3;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0d1117; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 480px; background-color: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 36px 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td style="padding-bottom: 24px; border-bottom: 1px solid #21262d;">
              <table role="presentation" width="100%">
                <tr>
                  <td style="display: flex; align-items: center;">
                    <div style="background: linear-gradient(135deg, #6366f1, #3b82f6); width: 36px; height: 36px; border-radius: 10px; display: inline-block; vertical-align: middle; text-align: center; line-height: 36px; font-weight: bold; color: #ffffff; font-size: 18px;">
                      &lt;/&gt;
                    </div>
                    <span style="font-size: 20px; font-weight: 800; color: #ffffff; margin-left: 12px; vertical-align: middle; letter-spacing: -0.02em;">
                      CodeSense
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding-top: 28px; padding-bottom: 8px;">
              <h1 style="font-size: 20px; font-weight: 700; color: #ffffff; margin: 0 0 12px 0;">
                Verify your email address
              </h1>
              <p style="font-size: 14px; line-height: 1.6; color: #8b949e; margin: 0 0 24px 0;">
                Hello <strong style="color: #e6edf3;">${displayName}</strong>,<br>
                Thank you for signing up for CodeSense. Enter the 6-digit verification code below to activate your account:
              </p>
            </td>
          </tr>

          <!-- OTP Box -->
          <tr>
            <td align="center" style="padding: 12px 0 28px 0;">
              <div style="background-color: #0d1117; border: 1px solid #388bfd; border-radius: 12px; padding: 18px 24px; display: inline-block; letter-spacing: 8px; font-size: 32px; font-weight: 800; font-family: monospace; color: #58a6ff; text-align: center;">
                ${code}
              </div>
              <p style="font-size: 12px; color: #8b949e; margin: 12px 0 0 0;">
                ⏱ This code expires in <strong>10 minutes</strong>.
              </p>
            </td>
          </tr>

          <!-- Security note -->
          <tr>
            <td style="border-top: 1px solid #21262d; padding-top: 20px;">
              <p style="font-size: 12px; line-height: 1.6; color: #8b949e; margin: 0 0 12px 0;">
                If you did not request this verification code, you can safely ignore this email. No changes will be made to your account.
              </p>
              <p style="font-size: 12px; color: #6e7681; margin: 0;">
                — The CodeSense Team
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (!isConfigured() || isTestRecipient(to)) {
    // Development / evaluation mode: Log clearly to server console
    console.log('\n' + '═'.repeat(68));
    console.log(` [CodeSense Email Service] (${isTestRecipient(to) ? 'Test Domain Bypassed' : 'Development Mode — SMTP not configured'})`);
    console.log(` To:      ${to}`);
    console.log(` Subject: ${subject}`);
    console.log(` PIN:     ${code} (Valid for 10 minutes)`);
    console.log(' (Set EMAIL_HOST, EMAIL_USERNAME, EMAIL_PASSWORD in .env for live delivery)');
    console.log('═'.repeat(68) + '\n');
    return { ok: true, simulated: true };
  }

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    console.log(`[email] Verification code sent to ${to} (MessageId: ${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Failed to send email to ${to}:`, err.message);
    // If SMTP connection is blocked or timed out (common on cloud free-tiers such as Render free plan):
    // Log the OTP clearly to server console so the registration is never permanently blocked
    console.log('\n' + '═'.repeat(68));
    console.log(` [CodeSense Email Fallback] OTP for ${to}: ${code}`);
    console.log(' (Outbound SMTP timed out or was filtered by host network)');
    console.log('═'.repeat(68) + '\n');
    const isNetworkTimeout = err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || /timeout/i.test(err.message);
    if (isNetworkTimeout || process.env.ALLOW_EMAIL_FALLBACK === 'true' || process.env.NODE_ENV !== 'production') {
      return { ok: true, simulated: true, fallback: true };
    }
    throw new Error('Unable to send the verification email. Please try again.');
  }
}

/**
 * Send notification email (Analysis Completed, Security Alert, Critical Issues, Subscription, etc.)
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} [options.name] - User name
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message
 * @param {string} [options.type] - Type of notification ('analysis_completed', 'subscription', 'security_alert', 'critical_issues', 'system')
 * @param {string} [options.repo] - Target repository
 * @param {string} [options.link] - Action link
 * @param {string} [options.buttonText] - Custom button text
 */
async function sendNotificationEmail({ to, name, title, message, type = 'analysis_completed', repo, link, buttonText }) {
  const displayName = name ? name.trim() : 'there';
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'CodeSense <no-reply@codesense.dev>';
  const subject = `[CodeSense] ${title}${repo ? ` — ${repo}` : ''}`;

  if (!isConfigured() || isTestRecipient(to)) {
    console.log(`[email] (${isTestRecipient(to) ? 'Test Domain Bypassed' : 'Dev/Test Mode'}) Notification email to ${to}: ${subject}`);
    return { ok: true, simulated: true };
  }

  const isSubscription = type === 'subscription' || /subscription|membership|billing|plan/i.test(title);

  const rawFrontend = (process.env.FRONTEND_URL || 'http://localhost:5173').trim().replace(/^['"]+|['"]+$/g, '');
  const prefixMatch = rawFrontend.match(/^[A-Za-z0-9_]+\s*=\s*(https?:\/\/.*)$/i);
  const frontendBase = (prefixMatch ? prefixMatch[1] : rawFrontend).trim().replace(/\/+$/, '');
  let badgeColor = '#22c55e';
  let badgeLabel = 'Analysis Completed';
  let buttonGradient = 'linear-gradient(135deg, #22c55e, #16a34a)';
  let defaultBtnText = 'View Review in CodeSense \u2192';
  let defaultLink = `${frontendBase}/history`;

  if (isSubscription) {
    badgeColor = '#6366f1';
    badgeLabel = 'Subscription';
    buttonGradient = 'linear-gradient(135deg, #6366f1, #4f46e5)';
    defaultBtnText = 'Manage Subscription \u2192';
    defaultLink = `${frontendBase}/settings/profile`;
  } else if (type === 'security_alert') {
    badgeColor = '#ef4444';
    badgeLabel = 'Security Alert';
    buttonGradient = 'linear-gradient(135deg, #ef4444, #dc2626)';
    defaultBtnText = 'View Security Alert \u2192';
    defaultLink = `${frontendBase}/history`;
  } else if (type === 'critical_issues') {
    badgeColor = '#f59e0b';
    badgeLabel = 'Critical Notice';
    buttonGradient = 'linear-gradient(135deg, #f59e0b, #d97706)';
    defaultBtnText = 'View Details \u2192';
    defaultLink = `${frontendBase}/history`;
  } else if (type === 'system') {
    badgeColor = '#3b82f6';
    badgeLabel = 'System Notice';
    buttonGradient = 'linear-gradient(135deg, #3b82f6, #2563eb)';
    defaultBtnText = 'Open CodeSense \u2192';
    defaultLink = frontendBase;
  }

  const finalActionUrl = link ? (link.startsWith('http') ? link : `${frontendBase}${link}`) : defaultLink;
  const finalBtnText = buttonText || defaultBtnText;

  const text = `Hello ${displayName},

${title}

${message}
${repo ? `Repository: ${repo}` : ''}

Action: ${finalActionUrl}

— CodeSense Team`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0d1117; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e6edf3;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0d1117; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 36px 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td style="padding-bottom: 24px; border-bottom: 1px solid #21262d;">
              <table role="presentation" width="100%">
                <tr>
                  <td>
                    <div style="background: linear-gradient(135deg, #6366f1, #3b82f6); width: 36px; height: 36px; border-radius: 10px; display: inline-block; vertical-align: middle; text-align: center; line-height: 36px; font-weight: bold; color: #ffffff; font-size: 18px;">
                      &lt;/&gt;
                    </div>
                    <span style="font-size: 20px; font-weight: 800; color: #ffffff; margin-left: 12px; vertical-align: middle; letter-spacing: -0.02em;">
                      CodeSense
                    </span>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; background-color: rgba(255, 255, 255, 0.06); border: 1px solid ${badgeColor}; color: ${badgeColor}; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px;">
                      ${badgeLabel}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding-top: 28px; padding-bottom: 16px;">
              <h1 style="font-size: 20px; font-weight: 700; color: #ffffff; margin: 0 0 12px 0;">
                ${title}
              </h1>
              <p style="font-size: 14px; line-height: 1.6; color: #8b949e; margin: 0 0 20px 0;">
                Hello <strong style="color: #e6edf3;">${displayName}</strong>,<br>
                ${message}
              </p>
              ${repo ? `
              <div style="background-color: #0d1117; border: 1px solid #30363d; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px;">
                <span style="font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px;">Repository</span>
                <span style="font-size: 14px; font-weight: 600; color: #58a6ff; font-family: monospace;">${repo}</span>
              </div>
              ` : ''}
              
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="border-radius: 8px; background: ${buttonGradient};">
                    <a href="${finalActionUrl}" target="_blank" style="font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; padding: 12px 24px; display: inline-block; border-radius: 8px;">
                      ${finalBtnText}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="border-top: 1px solid #21262d; padding-top: 20px;">
              <p style="font-size: 12px; line-height: 1.6; color: #6e7681; margin: 0;">
                You are receiving this automated email based on your CodeSense notification preferences.<br>
                Manage your preferences at <a href="${frontendBase}/settings/profile" style="color: #58a6ff; text-decoration: none;">Account Settings</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    console.log(`[email] Notification sent to ${to} (MessageId: ${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Failed to send notification email to ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  isConfigured,
  isTestRecipient,
  TEST_DOMAINS,
  sendVerificationEmail,
  sendNotificationEmail,
};
