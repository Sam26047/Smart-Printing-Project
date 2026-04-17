// backend/config/config.js
export default {
  db: {
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  jwtSecret: process.env.JWT_SECRET,
  port: process.env.PORT || 5000,
  email: {
    host:     process.env.EMAIL_HOST,
    port:     Number(process.env.EMAIL_PORT) || 587,
    user:     process.env.EMAIL_USER,
    pass:     process.env.EMAIL_PASS,
    from:     process.env.EMAIL_FROM || process.env.EMAIL_USER,
  },
};