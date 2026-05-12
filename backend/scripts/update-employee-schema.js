const { Client } = require('pg');
require('dotenv').config();

async function updateSchema() {
    const config = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 5432,
        ssl: {
            rejectUnauthorized: false
        }
    };

    const client = new Client(config);

    try {
        await client.connect();
        console.log("Connected to Azure PostgreSQL successfully!");

        console.log("Adding 'email' and 'billing_category' to 'employees' table...");
        
        // Check if columns exist before adding
        const checkColumns = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'employees' AND column_name IN ('email', 'billing_category');
        `);

        const existingColumns = checkColumns.rows.map(r => r.column_name);

        if (!existingColumns.includes('email')) {
            await client.query(`ALTER TABLE employees ADD COLUMN email VARCHAR(255);`);
            console.log("Added 'email' column.");
        }

        if (!existingColumns.includes('billing_category')) {
            await client.query(`ALTER TABLE employees ADD COLUMN billing_category VARCHAR(50) DEFAULT 'No';`);
            console.log("Added 'billing_category' column.");
        }

        console.log("✅ Schema updated successfully!");
    } catch (err) {
        console.error("❌ Error updating schema:", err.message);
    } finally {
        await client.end();
    }
}

updateSchema();
