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