const fs = require('fs');
const path = require('path');
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

async function checkAttendanceAndCleanup() {
    const csvPath = path.join(__dirname, '../../Apr\'26 CBRE.csv');
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');
    const csvIds = new Set();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length > 0) csvIds.add(parts[0].trim());
    }

    const res = await pool.query('SELECT employee_id FROM employees');
    const dbIds = res.rows.map(r => r.employee_id);
    const extraIds = dbIds.filter(id => !csvIds.has(id));

    console.log(`Found ${extraIds.length} extra employees. Cleaning up...`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const id of extraIds) {
            // Delete from attendance first due to FK
            await client.query('DELETE FROM attendance WHERE employee_id = $1', [id]);
            // Delete from po_sheet
            await client.query('DELETE FROM po_sheet WHERE employee_id = $1', [id]);
            // Delete from employees
            await client.query('DELETE FROM employees WHERE employee_id = $1', [id]);
            console.log(`Deleted employee and records for: ${id}`);
        }

        await client.query('COMMIT');
        console.log('✅ Cleanup successful! Only CSV employees remain.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Cleanup failed:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkAttendanceAndCleanup();
