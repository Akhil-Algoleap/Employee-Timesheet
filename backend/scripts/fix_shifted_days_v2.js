/**
 * Migration v2: Fix the broken migration that used getUTCDay() instead of getDay().
 * 
 * The previous migration used getUTCDay() which is 1 day behind in IST,
 * causing it to apply fixes to the wrong dates (e.g., Monday got "WE").
 * 
 * This script uses getDay() (LOCAL timezone) which matches the actual calendar.
 */
require('dotenv').config();
const db = require('../config/db');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function run() {
    console.log('=== Fix Migration v2 (using LOCAL timezone) ===\n');

    const allRows = await db.query('SELECT id, date, day, working_hours FROM attendance ORDER BY date');
    console.log(`Total attendance records: ${allRows.rows.length}`);

    let dayFixes = 0, friFixes = 0, satFixes = 0, sunFixes = 0, monFixes = 0;

    for (const row of allRows.rows) {
        const d = new Date(row.date);
        const localDay = DAY_NAMES[d.getDay()]; // LOCAL timezone - correct!
        const hours = String(row.working_hours || '').trim().toUpperCase();
        
        let newDay = null;
        let newHours = null;

        // Fix day label to match LOCAL day
        if (row.day !== localDay) {
            newDay = localDay;
            dayFixes++;
        }

        // Fix weekday "WE" → "8" (Mondays that got WE from broken migration)
        if (localDay !== 'Sat' && localDay !== 'Sun' && hours === 'WE') {
            newHours = '8';
            if (localDay === 'Mon') monFixes++;
            else friFixes++;
        }

        // Fix Saturday: should always be WE
        if (localDay === 'Sat' && hours !== 'WE') {
            newHours = 'WE';
            satFixes++;
        }

        // Fix Sunday: should always be WE  
        if (localDay === 'Sun' && hours !== 'WE') {
            newHours = 'WE';
            sunFixes++;
        }

        if (newDay && newHours) {
            await db.query('UPDATE attendance SET day = $1, working_hours = $2 WHERE id = $3', [newDay, newHours, row.id]);
        } else if (newDay) {
            await db.query('UPDATE attendance SET day = $1 WHERE id = $2', [newDay, row.id]);
        } else if (newHours) {
            await db.query('UPDATE attendance SET working_hours = $1 WHERE id = $2', [newHours, row.id]);
        }
    }

    console.log(`\n--- Results ---`);
    console.log(`Day label fixes: ${dayFixes}`);
    console.log(`Monday WE → 8: ${monFixes}`);
    console.log(`Other weekday WE → 8: ${friFixes}`);
    console.log(`Saturday → WE: ${satFixes}`);
    console.log(`Sunday → WE: ${sunFixes}`);

    // Verify
    console.log('\n--- Verification (C0030668 April 1-10) ---');
    const verify = await db.query(
        "SELECT date, day, working_hours FROM attendance WHERE employee_id = 'C0030668' AND date >= '2026-04-01' AND date <= '2026-04-10' ORDER BY date"
    );
    verify.rows.forEach(r => {
        const d = new Date(r.date);
        const localDay = DAY_NAMES[d.getDay()];
        const ok = r.day === localDay ? '✓' : '✗';
        const isWknd = localDay === 'Sat' || localDay === 'Sun';
        const weOk = isWknd ? (r.working_hours === 'WE' ? '✓WE' : '✗NOT-WE') : '';
        console.log(d.toString().substring(0,15), 'local:', localDay, 'db_day:', r.day, ok, 'hours:', r.working_hours, weOk);
    });

    console.log('\nDone!');
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
