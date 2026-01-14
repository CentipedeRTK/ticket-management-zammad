// ===== BEGIN FILE: zammad-form-kit/form-api/lib/email/confirmation.js =====

// --- HTML helpers
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STRINGS = {
  fr: {
    htmlLang: 'fr',
    title: 'Confirmation de réception',
    headerSubtitle: 'Confirmation de réception',
    hello: 'Bonjour',
    receiptIntro: 'Nous confirmons la bonne réception de votre déclaration pour la base GNSS',
    receiptTicket: 'Votre demande a été enregistrée sous le ticket',
    btnTicket: 'Accéder au ticket',
    reply1: 'Si vous avez des questions, vous pouvez répondre directement à cet email.',
    reply2: 'Toutefois, pour un meilleur suivi, nous vous recommandons de passer par le ticket (lien ci-dessous).',
    accountTitle: 'Accès à votre compte',
    accountIntro:
      "Si c’est votre première déclaration de base GNSS, un compte a été créé automatiquement avec l’adresse",
    accountResetPrefix: 'Pour définir votre mot de passe, utilisez',
    resetLabel: 'Mot de passe oublié',
    accountResetFallback:
      'Pour définir votre mot de passe, utilisez la fonction “Mot de passe oublié” sur la page de connexion.',
    footer: 'Message automatique — merci de ne pas partager d’informations sensibles par email.',
    footerTermsLabel: 'Centipede-RTK — Conditions générales',
    subjectPrefix: 'Confirmation de réception',
    subjectBase: 'Base GNSS',
  },
  en: {
    htmlLang: 'en',
    title: 'Submission received',
    headerSubtitle: 'Submission received',
    hello: 'Hello',
    receiptIntro: 'We confirm receipt of your GNSS base declaration',
    receiptTicket: 'Your request has been recorded under ticket',
    btnTicket: 'View ticket',
    reply1: 'If you have any questions, you can reply directly to this email.',
    reply2: 'However, for better tracking, we recommend using the ticket link below.',
    accountTitle: 'Access to your account',
    accountIntro:
      'If this is your first GNSS base declaration, an account has been created automatically with the email address',
    accountResetPrefix: 'To set your password, use',
    resetLabel: 'Forgot password',
    accountResetFallback: 'To set your password, use the “Forgot password” link on the login page.',
    footer: 'Automated message — please do not share sensitive information by email.',
    footerTermsLabel: 'Centipede-RTK — Terms & Conditions',
    subjectPrefix: 'Submission received',
    subjectBase: 'GNSS base',
  },
};

function parseAlpha3Csv(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

// Par défaut : noyau “pays FR usuels”. Tu peux élargir via env FRANCOPHONE_ALPHA3.
const DEFAULT_FRANCOPHONE_ALPHA3 = new Set(['FRA', 'BEL', 'CHE', 'LUX', 'MCO', 'CAN']);

export function pickLangFromCountryAlpha3(countryAlpha3) {
  const a3 = String(countryAlpha3 || '').trim().toUpperCase();
  if (!a3) return 'en';

  const envList = parseAlpha3Csv(process.env.FRANCOPHONE_ALPHA3);
  const francophone = envList.length ? new Set(envList) : DEFAULT_FRANCOPHONE_ALPHA3;

  return francophone.has(a3) ? 'fr' : 'en';
}

export function buildConfirmationSubject({ lang, ticketNumber, mountPoint }) {
  const s = STRINGS[lang] || STRINGS.en;

  const mp = String(mountPoint || '').trim();
  const mpPart = mp ? ` — ${s.subjectBase} ${mp}` : '';

  return `${s.subjectPrefix}${mpPart} — Ticket #${ticketNumber}`;
}

export function buildConfirmationEmailHtml({
  lang,
  helpdeskName,
  logoSrc, // data URI (ex: data:image/png;base64,...)
  termsUrl,
  contactName,
  customerEmail,
  ticketNumber,
  mountPoint,
  ticketUrl,
  passwordResetUrl,
}) {
  const s = STRINGS[lang] || STRINGS.en;

  const safeHelpdesk = escapeHtml(helpdeskName || '');
  const safeName = escapeHtml(contactName || '');
  const safeEmail = escapeHtml(customerEmail || '');
  const safeTicketNumber = escapeHtml(ticketNumber || '');
  const safeMountPoint = escapeHtml(String(mountPoint || '').trim());

  const safeTermsUrl = escapeHtml(termsUrl || 'https://www.centipede-rtk.org/terms-conditions');

  const btnStyle =
    'display:inline-block;padding:12px 16px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;';
  const btnPrimary = btnStyle + 'background:#111827;color:#ffffff;';

  const resetLink = passwordResetUrl
    ? `<a href="${escapeHtml(passwordResetUrl)}" style="color:#2563eb;text-decoration:underline;">${escapeHtml(s.resetLabel)}</a>`
    : null;

  const mountPointFragment = safeMountPoint ? ` <strong>${safeMountPoint}</strong>` : '';

  const ticketBtnLabel = `${escapeHtml(s.btnTicket)} #${safeTicketNumber}`;

  // Logo plus grand + stable en rendu email
  const logoHtml = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="${safeHelpdesk}"
         height="64"
         style="display:block;height:64px;width:auto;max-width:260px;">`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(s.htmlLang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(s.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;">
      <tr>
        <td align="center" style="padding:26px 12px;">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:18px 22px;border-bottom:1px solid #e5e7eb;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td valign="middle" style="width:74px;padding-right:12px;">
                      ${logoHtml}
                    </td>
                    <td valign="middle">
                      <div style="font-size:18px;font-weight:800;color:#111827;line-height:22px;">${safeHelpdesk}</div>
                      <div style="font-size:13px;color:#6b7280;margin-top:4px;line-height:18px;">${escapeHtml(
                        s.headerSubtitle,
                      )}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 22px;color:#111827;font-size:16px;line-height:24px;">
                <p style="margin:0 0 14px 0;">${escapeHtml(s.hello)}${safeName ? ` ${safeName}` : ''},</p>

                <p style="margin:0 0 14px 0;">
                  ${escapeHtml(s.receiptIntro)}${mountPointFragment}.<br>
                  ${escapeHtml(s.receiptTicket)} <strong>#${safeTicketNumber}</strong>.
                </p>

                <!-- Espace demandé entre ticket et questions -->
                <div style="height:10px;line-height:10px;font-size:10px;">&nbsp;</div>

                <p style="margin:0 0 14px 0;">
                  ${escapeHtml(s.reply1)}<br>
                  ${escapeHtml(s.reply2)}
                </p>

                ${
                  ticketUrl
                    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0 18px 0;">
                        <tr>
                          <td>
                            <a href="${escapeHtml(ticketUrl)}" style="${btnPrimary}">${ticketBtnLabel}</a>
                          </td>
                        </tr>
                      </table>`
                    : ''
                }

                <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;">

                <p style="margin:0 0 8px 0;font-weight:800;font-size:15px;line-height:20px;">${escapeHtml(
                  s.accountTitle,
                )}</p>
                <p style="margin:0;font-size:15px;line-height:22px;">
                  ${escapeHtml(s.accountIntro)} <strong>${safeEmail}</strong>.<br>
                  ${
                    resetLink
                      ? `${escapeHtml(s.accountResetPrefix)} ${resetLink}.`
                      : `${escapeHtml(s.accountResetFallback)}`
                  }
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 22px;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:#6b7280;">
                ${escapeHtml(s.footer)}<br>
                <a href="${safeTermsUrl}" style="color:#6b7280;text-decoration:underline;">${escapeHtml(
                  s.footerTermsLabel,
                )}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
