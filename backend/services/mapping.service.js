const supabase = require('../config/supabase');
const crypto = require('crypto');
const xlsx = require('xlsx');

/**
 * Maps CBRE Excel Row (Array form from header:1) to Standardized Tables
 */
async function processRelational(rows, metadata = {}) {
    if (!rows || rows.length < 5) {
        console.log("Skipping Phase 2: Not enough rows for processing.");
        return;
    }

    try {
        // 1. Find Header Row dynamically
        const headerRowIndex = rows.findIndex(r => r && r[0] && String(r[0]).includes('Employee Name'));
        if (headerRowIndex === -1) {
            console.log("Skipping Phase 2: 'Employee Name' header not found.");
            return;
        }

        const headers = rows[headerRowIndex]; 
        const dataRows = rows.slice(headerRowIndex + 2); // Data starts after Header and DayNames rows

        let processedCount = 0;
        for (const row of dataRows) {
            // Skip empty rows or decoration rows
            if (!row || row.length === 0) continue;
            
            const employeeName = String(row[0] || '').trim();
            const employeeId = String(row[1] || '').trim();

            // Skip template/blank rows
            if (!employeeId || employeeId === 'null' || employeeId === 'undefined' || employeeId.length < 2) {
                console.log(`Skipping row: Invalid/Empty Employee ID (${employeeId})`);
                continue;
            }
            if (employeeName === '' || employeeName === 'null') {
                console.log(`Skipping row: Invalid/Empty Employee Name (${employeeName})`);
                continue;
            }

            processedCount++;
            const joiningDateRaw = row[2];
            const managerName = row[3];
            const clientName = 'CBRE';

            // 1. Process Employee
            let joiningDate = null;
            if (joiningDateRaw) {
                try {
                    const dateObj = typeof joiningDateRaw === 'number' 
                        ? new Date(Math.round((joiningDateRaw - 25569) * 86400 * 1000)).toISOString()
                        : new Date(joiningDateRaw).toISOString();
                    joiningDate = dateObj;
                } catch (e) { console.log(`Invalid date format for employee ${employeeId}`); }
            }

            await supabase.from('employees').upsert({
                full_name: employeeName,
                external_id: employeeId,
                joining_date: joiningDate,
                manager_name: managerName || null,
                client_name: clientName
            }, { onConflict: 'external_id' });

            // 2. Process Attendance (Columns 5 to 35)
            for (let i = 5; i <= 35; i++) {
                const status = row[i];
                const headerDateRaw = headers[i];

                if (status && headerDateRaw && status !== 'null') {
                    const workDate = typeof headerDateRaw === 'number'
                        ? new Date(Math.round((headerDateRaw - 25569) * 86400 * 1000)).toISOString().split('T')[0]
                        : null;

                    if (workDate) {
                        const totalHours = (status === '8' || typeof status === 'number') ? parseFloat(status) || 8 : 0;
                        
                        await supabase.from('attendance').upsert({
                            employee_id: employeeId,
                            work_date: workDate,
                            status: String(status),
                            total_hours: totalHours,
                            source_row_hash: crypto.createHash('md5').update(`${employeeId}_${workDate}`).digest('hex')
                        }, { onConflict: 'employee_id,work_date' });
                    }
                }
            }

            // 3. Process Logic/Log Row
            const generatedEmail = `${employeeId.toLowerCase()}@${clientName.toLowerCase()}.com`;
            const entryTitle = `Submission for ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}`;

            await supabase.from('timesheet_log').insert({
                employee_email: generatedEmail,
                entry_title: entryTitle,
                external_id: employeeId,
                processed_at: new Date().toISOString()
            });
        }

        console.log(`Phase 2: Standardized processing completed for ${processedCount} valid employees.`);
    } catch (error) {
        console.error("Error in relational processing:", error);
    }
}

module.exports = {
    processRelational
};
