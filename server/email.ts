// Transactional email via Resend. Deliberately optional: without
// RESEND_API_KEY in the environment this is a silent no-op, so the portal
// works fully offline in dev and email switches on in production by just
// setting the key (and optionally EMAIL_FROM).
const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'LA Tech Portal <portal@latechs.org>';
const APP_URL = process.env.APP_URL || 'http://localhost:5184';

export function sendEmail(to: string, subject: string, bodyText: string, link = '') {
  if (!API_KEY) return; // not configured — in-app notifications still work

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#09090B;color:#FAFAFA;padding:32px">
      <div style="font-weight:700;font-size:18px;margin-bottom:16px">
        LATech <span style="color:#DFE104">Portal</span>
      </div>
      <p style="color:#D4D4D8;font-size:14px;line-height:1.6">${bodyText}</p>
      ${link ? `<a href="${APP_URL}${link}" style="display:inline-block;margin-top:16px;background:#DFE104;color:#000;padding:10px 20px;text-decoration:none;font-weight:700">Open in portal</a>` : ''}
    </div>`;

  // Fire-and-forget: an email failure must never fail the API request.
  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  }).catch((e) => console.error('[email] send failed:', e?.message ?? e));
}
