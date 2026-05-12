const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 5432,
    ssl: {
        rejectUnauthorized: false
    },
    // Azure-specific optimizations
    max: 10, // Lowered to be safe with Azure connection limits
    idleTimeoutMillis: 10000, // Close idle connections quickly
    connectionTimeoutMillis: 30000, // Wait up to 30s for a connection (Azure can be slow)
    keepAlive: true,
});

// Test connection
pool.on('connect', (client) => {
    // client.query('SET client_encoding = \'UTF8\'');
});

pool.on('error', (err) => {
    console.error('⚠️ Unexpected error on idle Azure client:', err.message);
});

/**
 * Robust query wrapper with retry logic for transient errors (ECONNRESET, etc)
 */
async function query(text, params, retries = 5) {
    let attempt = 0;
    while (attempt < retries) {
        try {
            return await pool.query(text, params);
        } catch (err) {
            attempt++;
            // Check for transient Azure/Network errors
            const isTransient = 
                err.message.includes('terminated') || 
                err.message.includes('timeout') ||
                err.code === 'ECONNRESET' || 
                err.code === '57P01' ||
                err.code === '08006' || // connection_failure
                err.code === '08001';   // sqlclient_unable_to_establish_sqlconnection
            
            if (isTransient && attempt < retries) {
                const delay = 2000 * attempt; // Increasing delay: 2s, 4s, 6s...
                console.warn(`🔄 DB Query transient error (attempt ${attempt}/${retries}): ${err.message}. Retrying in ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay));
                continue;
            }
            throw err;
        }
    }
}

module.exports = {
    query,
    pool
};
