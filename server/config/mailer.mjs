import nodemailer from 'nodemailer';

const toInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const createMailer = () => {
  if (process.env.SMTP_URL) {
    return nodemailer.createTransport(process.env.SMTP_URL);
  }

  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();

  if (host && user && pass) {
    const port = toInt(process.env.SMTP_PORT, 587);
    const secure = String(process.env.SMTP_SECURE || '') === 'true' || port === 465;
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }

  if (String(process.env.MAILER_USE_SENDMAIL || 'false') === 'true') {
    return nodemailer.createTransport({
      sendmail: true,
      newline: 'unix',
      path: process.env.SENDMAIL_PATH || '/usr/sbin/sendmail',
    });
  }

  return nodemailer.createTransport({
    jsonTransport: true,
  });
};
