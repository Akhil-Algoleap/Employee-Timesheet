/**
 * Script to cleanup ghost data for future months (May 2026 onwards).
 * This will clear the dashboard stats for future months.
 */
require('dotenv').config();
const db = require('../config/db');

async function run() {
    console.log('=== Cleaning up Ghost Data (May 2026+) ===\n');

    try {
        // 1. Delete future attendance records
        console.log('1. Deleting attendance records from May 2026 onwards...');
        const attRes = await db.query(
            "DELETE FROM attendance WHERE date >= '2026-05-01' OR date > '3000-01-01'"
        );
        console.log(`   Deleted ${attRes.rowCount} attendance records.`);

        // 2. Reset PO sheet status for future months
        console.log('\n2. Resetting received status in PO Sheet for May 2026 onwards...');
        const poRes = await db.query(
            "UPDATE po_sheet SET received_via_email = false, is_finalized = false WHERE (year = 2026 AND month >= 5) OR year > 2026"
        );
        console.log(`   Updated ${poRes.rowCount} PO Sheet records.`);

        console.log('\nCleanup completed successfully!');
    } catch (err) {
        console.error('Error during cleanup:', err);
    } finally {
        process.exit(0);
    }
}

run();
