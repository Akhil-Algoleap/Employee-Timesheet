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
    }
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("Adding target_month and target_year to timesheet_logs...");
        await client.query(`
            ALTER TABLE timesheet_logs 
            ADD COLUMN IF NOT EXISTS target_month INTEGER,
            ADD COLUMN IF NOT EXISTS target_year INTEGER;
        `);
        console.log("✅ Migration successful!");
    } catch (err) {
        console.error("❌ Migration failed:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
