import nodemailer from 'nodemailer';

export const createMailer = () => {
  if (process.env.SMTP_URL) {
    return nodemailer.createTransport(process.env.SMTP_URL);
  }

  return nodemailer.createTransport({
    jsonTransport: true,
  });
};
