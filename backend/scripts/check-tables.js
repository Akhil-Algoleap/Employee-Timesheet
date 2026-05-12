const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');

async function checkTables() {
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
        console.log("✅ Successfully connected to Azure PostgreSQL!");

        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `);

        if (res.rows.length === 0) {
            console.log("❓ No tables found in the 'public' schema.");
        } else {
            console.log("\n🚀 Found the following tables in Azure:");
            res.rows.forEach((row, i) => {
                console.log(`${i + 1}. ${row.table_name}`);
            });
        }

    } catch (err) {
        console.error("❌ Error checking tables:", err.message);
    } finally {
        await client.end();
    }
}

checkTables();
