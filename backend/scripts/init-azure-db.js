const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Client } = require('pg');

async function initDb() {
    const config = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 5432,
        ssl: true
    };

    if (!config.password) {
        console.error("❌ Error: AZURE_DB_PASSWORD is missing in .env file");
        return;
    }

    const client = new Client(config);

    try {
        await client.connect();
        console.log("Connected to Azure PostgreSQL successfully!");

        // 1. Create Employees Table
        console.log("Creating 'employees' table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS employees (
                employee_id VARCHAR(255) PRIMARY KEY,
                employee_name VARCHAR(255) NOT NULL,
                joining_date DATE,
                reporting_manager VARCHAR(255),
                dt_leader VARCHAR(255),
                client VARCHAR(255) DEFAULT 'CBRE',
                email VARCHAR(255),
                billing_category VARCHAR(50) DEFAULT 'No'
            );
        `);

        // 2. Create Attendance Table
        console.log("Creating 'attendance' table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS attendance (
                id SERIAL PRIMARY KEY,
                employee_id VARCHAR(255) REFERENCES employees(employee_id),
                date DATE NOT NULL,
                day VARCHAR(50),
                working_hours VARCHAR(50),
                UNIQUE(employee_id, date)
            );
        `);

        // 3. Create PO Sheet Table
        console.log("Creating 'po_sheet' table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS po_sheet (
                id SERIAL PRIMARY KEY,
                employee_id VARCHAR(255) REFERENCES employees(employee_id),
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                invoice_no VARCHAR(255),
                po_number VARCHAR(255),
                sow_no VARCHAR(255),
                cbre_idc_leader VARCHAR(255),
                rate_per_hour NUMERIC(10, 2),
                gst NUMERIC(5, 2) DEFAULT 18.00,
                timesheet_received VARCHAR(50),
                timesheet_verified VARCHAR(50),
                timesheet_sent_to_cbre VARCHAR(50),
                approvals VARCHAR(50),
                notes TEXT,
                work_location VARCHAR(255),
                resource_type VARCHAR(255),
                vendor_name VARCHAR(255) DEFAULT 'Algoleap',
                exits VARCHAR(255),
                is_finalized BOOLEAN DEFAULT FALSE,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(employee_id, year, month)
            );
        `);

        // 4. Create Logs Table
        console.log("Creating 'timesheet_logs' table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS timesheet_logs (
                id SERIAL PRIMARY KEY,
                extracted_timesheet_filename VARCHAR(255),
                storage_path TEXT,
                outlook_message_id TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                error_message TEXT,
                received_at TIMESTAMPTZ,
                target_month INTEGER,
                target_year INTEGER,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("\n✅ All tables created successfully on Azure!");
    } catch (err) {
        console.error("❌ Error initializing Azure database:", err.message);
    } finally {
        await client.end();
    }
}

initDb();
