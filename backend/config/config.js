// backend/config/config.js
export default {
  db: {
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  jwtSecret:   process.env.JWT_SECRET,
  agentSecret: process.env.AGENT_SECRET, // shared secret between backend and local print agent
  //  This reads the secret from your .env and makes it available to the rest of the backend. The agent controller uses it to verify incoming requests are really from your print agent and not some random caller.
  port: process.env.PORT || 5000,
  email: {
    host:  process.env.EMAIL_HOST,
    port:  Number(process.env.EMAIL_PORT) || 587,
    user:  process.env.EMAIL_USER,
    pass:  process.env.EMAIL_PASS,
    from:  process.env.EMAIL_FROM || process.env.EMAIL_USER,
  },
};