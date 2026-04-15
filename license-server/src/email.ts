// ============================================================================
// ERGENEKON LICENSE SERVER — Email Delivery via Resend
//
// Sends the signed .ergenekon-license.json to the customer via email.
// Uses Resend (https://resend.com) for transactional email delivery.
//
// Env: RESEND_API_KEY must be set for email delivery.
// ============================================================================

interface EmailPayload {
  to: string;
  customerName: string;
  tier: string;
  licenseId: string;
  licenseJSON: string;
}

/**
 * Send the license key to the customer via email.
 * Falls back to console logging if RESEND_API_KEY is not configured.
 */
export async function sendLicenseEmail(payload: EmailPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[EMAIL] ⚠️  RESEND_API_KEY not set — printing license to console instead');
    console.log(`[EMAIL] Would send to: ${payload.to}`);
    console.log(`[EMAIL] License:\n${payload.licenseJSON}`);
    return false;
  }

  const tierLabel = payload.tier === 'enterprise' ? 'Enterprise' : 'Pro';
  const tierColor = payload.tier === 'enterprise' ? '#f59e0b' : '#6366f1';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#050508;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;">
    
    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:48px;margin-bottom:8px;">🐺</div>
      <h1 style="color:#eaecf0;font-size:24px;font-weight:800;letter-spacing:2px;margin:0;">
        ERGENEKON
      </h1>
      <p style="color:#8891a4;font-size:13px;margin:4px 0 0;">Time-Travel Debugger</p>
    </div>

    <!-- Main Card -->
    <div style="background:#0b0c12;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:32px;margin-bottom:24px;">
      <h2 style="color:#eaecf0;font-size:20px;margin:0 0 8px;">Welcome, ${payload.customerName}! 🎉</h2>
      <p style="color:#8891a4;font-size:14px;line-height:1.6;margin:0 0 24px;">
        Your <span style="color:${tierColor};font-weight:700;">${tierLabel}</span> license is ready.
        Attach the license file below to your project and unlock all features.
      </p>

      <!-- License Badge -->
      <div style="background:#12141c;border:1px solid rgba(99,102,241,0.2);border-radius:8px;padding:16px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span style="color:#505872;font-size:11px;text-transform:uppercase;letter-spacing:1px;">License ID</span>
          <span style="color:#6366f1;font-size:12px;font-family:monospace;">${payload.licenseId}</span>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#505872;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Tier</span>
          <span style="color:${tierColor};font-size:12px;font-weight:700;">${tierLabel}</span>
        </div>
      </div>

      <!-- Quick Start -->
      <h3 style="color:#eaecf0;font-size:14px;margin:0 0 12px;">⚡ Quick Start</h3>
      <div style="background:#12141c;border-radius:8px;padding:16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#a5d6ff;line-height:1.8;">
        <div style="color:#505872;"># 1. Install packages</div>
        <div>npm install @ergenekon/probe @ergenekon/collector</div>
        <br>
        <div style="color:#505872;"># 2. Save the attached license file</div>
        <div>cp ~/Downloads/.ergenekon-license.json ./</div>
        <br>
        <div style="color:#505872;"># 3. Start the collector</div>
        <div>npx @ergenekon/collector</div>
        <br>
        <div style="color:#505872;"># 4. Open the dashboard</div>
        <div>npx @ergenekon/ui</div>
        <div style="color:#505872;margin-top:4px;"># → http://localhost:3001 🐺</div>
      </div>
    </div>

    <!-- Resources -->
    <div style="background:#0b0c12;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:24px;margin-bottom:24px;">
      <h3 style="color:#eaecf0;font-size:14px;margin:0 0 12px;">📚 Resources</h3>
      <div style="font-size:13px;line-height:2;">
        <a href="https://ergenekon.dev/docs.html" style="color:#6366f1;text-decoration:none;">Documentation →</a><br>
        <a href="https://github.com/zencefilefendi/ergenekon-engine" style="color:#6366f1;text-decoration:none;">GitHub Repository →</a><br>
        <a href="https://ergenekon.dev/faq.html" style="color:#6366f1;text-decoration:none;">FAQ →</a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0;">
      <p style="color:#505872;font-size:11px;margin:0;">
        ERGENEKON Engine — Deterministic Session Recording for Node.js<br>
        <a href="https://ergenekon.dev" style="color:#6366f1;text-decoration:none;">ergenekon.dev</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ERGENEKON <license@ergenekon.dev>',
        to: [payload.to],
        subject: `Your ERGENEKON ${tierLabel} License 🐺`,
        html: htmlBody,
        attachments: [
          {
            filename: '.ergenekon-license.json',
            content: Buffer.from(payload.licenseJSON).toString('base64'),
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[EMAIL] Resend API error (${response.status}): ${error}`);
      return false;
    }

    const result = await response.json() as { id: string };
    console.log(`[EMAIL] ✅ License sent to ${payload.to} (Resend ID: ${result.id})`);
    return true;
  } catch (err) {
    console.error('[EMAIL] Failed to send:', err);
    return false;
  }
}
