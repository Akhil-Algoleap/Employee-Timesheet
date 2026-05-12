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

async function findExtraEmployees() {
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

    const res = await pool.query('SELECT employee_id, employee_name FROM employees');
    const dbEmployees = res.rows;

    const extra = dbEmployees.filter(e => !csvIds.has(e.employee_id));

    console.log(`Total in CSV: ${csvIds.size}`);
    console.log(`Total in DB: ${dbEmployees.length}`);
    console.log(`Extra in DB: ${extra.length}`);
    console.log('--- Extra Employees ---');
    extra.forEach(e => console.log(`${e.employee_id}: ${e.employee_name}`));

    await pool.end();
}

findExtraEmployees();
