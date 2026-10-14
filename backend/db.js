const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const pool = new Pool({
    ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    }),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
});

// Connect only when handling a request; avoid reserving a connection at cold start.
pool.on('error', err => console.error('PostgreSQL connection error:', err.message));

// ✅ ป้องกัน server crash เมื่อ connection หลุดกลางทาง
pool.on('error', (err) => {
    console.error('⚠️ PostgreSQL connection error:', err.message);
});

module.exports = pool;