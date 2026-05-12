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

async function importCsv() {
    const csvPath = path.join(__dirname, '../../Apr\'26 CBRE.csv');
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');
    const headers = lines[0].split(',');

    console.log(`Starting import of ${lines.length - 2} employees...`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple CSV split (note: doesn't handle commas in quotes, but these names look clean)
            const parts = line.split(',');
            if (parts.length < 5) continue;

            const [empId, name, email, dtLeader, manager] = parts;

            const query = `
                INSERT INTO employees (employee_id, employee_name, email, dt_leader, reporting_manager, client, billing_category)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (employee_id) 
                DO UPDATE SET 
                    employee_name = EXCLUDED.employee_name,
                    email = EXCLUDED.email,
                    dt_leader = EXCLUDED.dt_leader,
                    reporting_manager = EXCLUDED.reporting_manager,
                    client = EXCLUDED.client,
                    billing_category = EXCLUDED.billing_category;
            `;

            await client.query(query, [
                empId.trim(),
                name.trim(),
                email.trim(),
                dtLeader.trim(),
                manager.trim(),
                'CBRE',
                'No'
            ]);
            
            if (i % 50 === 0) console.log(`Processed ${i} rows...`);
        }

        await client.query('COMMIT');
        console.log('✅ Import completed successfully!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error during import:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

importCsv();
