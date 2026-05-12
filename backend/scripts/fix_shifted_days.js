/**
 * Migration: Fix shifted day labels and weekend markers in attendance data.
 * 
 * The old parser had a bug where the day-of-week was calculated 1 day ahead:
 *   - Fridays were labeled as "Sat" and got "WE"
 *   - Sundays were labeled as "Mon" and got working hours like "8"
 *   - All day labels are off by +1
 *
 * This script:
 *   1. Fixes the `day` column to match the actual date
 *   2. Sets Fridays that have "WE" to "8" (default working hours)
 *   3. Sets Sundays that have numeric values to "WE"
 */
require('dotenv').config();
const db = require('../config/db');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function run() {
    console.log('=== Fix Shifted Days Migration ===\n');

    // 1. Fix ALL day labels to match the actual date
    const allRows = await db.query('SELECT id, date, day, working_hours FROM attendance ORDER BY date');
    console.log(`Total attendance records: ${allRows.rows.length}`);

    let dayLabelFixes = 0;
    let fridayWEFixes = 0;
    let sundayWorkFixes = 0;
    let saturdayFixes = 0;

    for (const row of allRows.rows) {
        const d = new Date(row.date);
        const actualDay = DAY_NAMES[d.getUTCDay()];
        const dbDay = row.day;
        const hours = String(row.working_hours || '').trim().toUpperCase();

        let newDay = null;
        let newHours = null;

        // Fix day label if wrong
        if (dbDay !== actualDay) {
            newDay = actualDay;
            dayLabelFixes++;
        }

        // Fix Friday with WE → should be 8
        if (actualDay === 'Fri' && hours === 'WE') {
            newHours = '8';
            fridayWEFixes++;
        }

        // Fix Saturday without WE → should be WE
        if (actualDay === 'Sat' && hours !== 'WE') {
            newHours = 'WE';
            saturdayFixes++;
        }

        // Fix Sunday with numeric value → should be WE
        if (actualDay === 'Sun' && hours !== 'WE') {
            newHours = 'WE';
            sundayWorkFixes++;
        }

        // Apply fixes
        if (newDay && newHours) {
            await db.query('UPDATE attendance SET day = $1, working_hours = $2 WHERE id = $3', [newDay, newHours, row.id]);
        } else if (newDay) {
            await db.query('UPDATE attendance SET day = $1 WHERE id = $2', [newDay, row.id]);
        } else if (newHours) {
            await db.query('UPDATE attendance SET working_hours = $1 WHERE id = $2', [newHours, row.id]);
        }
    }

    console.log(`\n--- Results ---`);
    console.log(`Day label fixes: ${dayLabelFixes}`);
    console.log(`Friday WE → 8: ${fridayWEFixes}`);
    console.log(`Saturday non-WE → WE: ${saturdayFixes}`);
    console.log(`Sunday numeric → WE: ${sundayWorkFixes}`);

    // Verify a sample
    console.log('\n--- Verification (C0030668 April) ---');
    const verify = await db.query(
        "SELECT date, day, working_hours FROM attendance WHERE employee_id = 'C0030668' AND date >= '2026-04-01' AND date <= '2026-04-10' ORDER BY date"
    );
    verify.rows.forEach(r => {
        const d = new Date(r.date);
        console.log(d.toISOString().split('T')[0], r.day, r.working_hours);
    });

    console.log('\nDone!');
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
