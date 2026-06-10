import nodemailer from 'nodemailer';

const SMTP_HOST = process.env.SMTP_HOST?.trim();
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER?.trim();
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM?.trim() || SMTP_USER;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';

export function isEmailConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function createTransport() {
  if (!isEmailConfigured()) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

/**
 * @param {{ to: string, name: string, resetUrl: string }} params
 */
export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const subject = 'Restablece tu contraseña — Mini Super Curiel';
  const text = [
    `Hola ${name || 'cliente'},`,
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta.',
    'Si fuiste tú, abre este enlace (válido por 1 hora):',
    resetUrl,
    '',
    'Si no solicitaste este cambio, ignora este correo.',
  ].join('\n');

  const html = `
    <p>Hola <strong>${escapeHtml(name || 'cliente')}</strong>,</p>
    <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en Mini Super Curiel.</p>
    <p><a href="${resetUrl}" style="color:#DC143C;font-weight:600;">Restablecer contraseña</a></p>
    <p style="color:#666;font-size:14px;">El enlace expira en 1 hora. Si no solicitaste este cambio, ignora este mensaje.</p>
  `;

  const transport = createTransport();
  if (!transport) {
    console.warn('[email] SMTP no configurado. Enlace de recuperación:', resetUrl);
    return { delivered: false, logged: true };
  }

  await transport.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
    html,
  });

  return { delivered: true, logged: false };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
