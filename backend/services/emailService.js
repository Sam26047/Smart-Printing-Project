// backend/services/emailService.js
import nodemailer from "nodemailer";
import config from "../config/config.js";

//create an SMTP client using nodemailer
const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: false, // true for port 465, false for 587
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

//Build email content (text+html) and sends email using sendMail
export const sendOTPEmail = async (toEmail, otp, jobId) => {
  await transporter.sendMail({
    from: `"Print Shop" <${config.email.from}>`,
    to: toEmail,
    subject: "Your print job is ready — OTP inside",
    text: `Your print job (${jobId.slice(0, 8)}...) is ready for collection.\n\nOTP: ${otp}\n\nThis code expires in 10 minutes.`,
    html: `
      <h2>Your print job is ready</h2>
      <p>Job ID: <code>${jobId.slice(0, 8)}...</code></p>
      <h1 style="letter-spacing: 8px; color: #1a1a1a;">${otp}</h1>
      <p>Show this code at the counter to collect your print. It expires in <strong>10 minutes</strong>.</p>
    `,
  });
};

// generic status change notification
export const sendStatusEmail = async (toEmail, jobId, newStatus) => {
  const statusMessages = {
    QUEUED: {
      subject: "Your print job has been queued",
      heading: "Job added to the queue",
      body: "Your job is now in the print queue and will begin printing shortly.",
    },
    READY: {
      subject: "Your print job is ready for collection!",
      heading: "Ready for collection",
      body: "Your documents are printed and ready. Head to the counter and use your OTP to collect them.",
    },
  };
  const msg = statusMessages[newStatus];
  if (!msg) return; // don't email for other transitions

  await transporter.sendMail({
    from: `"Print Shop" <${config.email.from}>`,
    to: toEmail,
    subject: msg.subject,
    text: `${msg.heading}\n\nJob ID: ${jobId.slice(0, 8)}...\n\n${msg.body}`,
    html: `
      <h2>${msg.heading}</h2>
      <p>Job ID: <code>${jobId.slice(0, 8)}...</code></p>
      <p>${msg.body}</p>
    `,
  });
};