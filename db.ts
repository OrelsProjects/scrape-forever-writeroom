import knex from "knex";

const db = knex({
  client: "pg",
  connection: {
    host: "articles-generator.cf88i06c88t6.us-east-1.rds.amazonaws.com",
    user: "postgres",
    password: "3BaKPKtHftPmJnPRVCl8",
    database: "postgres",
    ssl: { rejectUnauthorized: false }, // Allow SSL
  },
  pool: {
    min: 2, // Minimum number of connections
    max: 10, // Increase max pool size (adjust as needed)
    acquireTimeoutMillis: 60000, // 60s timeout to acquire a connection
    idleTimeoutMillis: 30000, // Free idle connections after 30s
  },
});

export {
  db,
}; 