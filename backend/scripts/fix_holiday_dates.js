/**
 * Script to fix specific Public Holiday (PH) dates that were shifted by 1 day.
 * 
 * Correct Dates: Jan 1, Jan 15, Jan 26, Mar 3, Mar 19
 * Current (Wrong) Dates: Jan 2, Jan 16, Jan 27, Mar 4, Mar 20
 */
require('dotenv').config();
const db = require('../config/db');

const shifts = [
    { wrong: '2026-01-02', correct: '2026-01-01' },
    { wrong: '2026-01-16', correct: '2026-01-15' },
    { wrong: '2026-01-27', correct: '2026-01-26' },
    { wrong: '2026-03-04', correct: '2026-03-03' },
    { wrong: '2026-03-20', correct: '2026-03-19' }
];

async function run() {
    console.log('=== Fixing Shifted Holiday Dates (PH) ===\n');

    for (const shift of shifts) {
        console.log(`Processing: ${shift.wrong} -> ${shift.correct}`);
        
        // 1. Find employees who have PH on the wrong date
        const res = await db.query(
            "SELECT employee_id FROM attendance WHERE date = $1 AND working_hours = 'PH'",
            [shift.wrong]
        );
        
        console.log(`  Found ${res.rows.length} employees with PH on ${shift.wrong}`);

        for (const row of res.rows) {
            const empId = row.employee_id;

            // 2. Move PH to the correct date
            // Update the correct date to PH
            await db.query(
                "UPDATE attendance SET working_hours = 'PH' WHERE employee_id = $1 AND date = $2",
                [empId, shift.correct]
            );

            // 3. Reset the wrong date to '8' (or keep it if it was something else, but here we know it was PH)
            // We set it to '8' because it's now a working day that was previously mislabeled as PH
            await db.query(
                "UPDATE attendance SET working_hours = '8' WHERE employee_id = $1 AND date = $2",
                [empId, shift.wrong]
            );
        }
        console.log(`  Finished shifting PH for ${shift.wrong}\n`);
    }

    console.log('--- Verification ---');
    const allCorrectDates = shifts.map(s => s.correct);
    const allWrongDates = shifts.map(s => s.wrong);
    
    const checkQuery = `
        SELECT date, working_hours, COUNT(*) 
        FROM attendance 
        WHERE (date = ANY($1) OR date = ANY($2)) 
        AND working_hours = 'PH'
        GROUP BY date, working_hours
        ORDER BY date
    `;
    const checkRes = await db.query(checkQuery, [allCorrectDates, allWrongDates]);
    
    console.log('Current PH distribution:');
    checkRes.rows.forEach(r => {
        console.log(`${r.date.toISOString().split('T')[0]}: ${r.count} records`);
    });

    console.log('\nDone!');
    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
