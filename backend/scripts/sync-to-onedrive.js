const db = require('../config/db');
const onedrive = require('../services/onedrive.service');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function syncAll() {
    try {
        console.log("🚀 Starting Robust Full Sync: Database -> OneDrive...");

        // 1. Sync Employees
        console.log("\nSyncing Employees (Sheet: Employee Details)...");
        const emps = (await db.query('SELECT * FROM employees ORDER BY employee_id')).rows;
        const onedriveEmps = await onedrive.getTableRows('EmployeesTable');
        
        let snoCounter = 1; // Start from 1 to re-index everything correctly
        for (const emp of emps) {
            try {
                const empToSave = {
                    "S.No": snoCounter++,
                    "Name": emp.employee_name,
                    "CBRE EMP ID": emp.employee_id,
                    "Joining Date": emp.joining_date ? (emp.joining_date instanceof Date ? emp.joining_date.toISOString().split('T')[0] : emp.joining_date) : '',
                    "Email": emp.email || '',
                    "D&T Leader": emp.dt_leader || '',
                    "Reporting Manager": emp.reporting_manager || '',
                    "Client": emp.client || 'CBRE',
                    "Billing Category": emp.billing_category || 'No'
                };
                const existing = onedriveEmps.find(e => e["CBRE EMP ID"] === emp.employee_id);
                if (existing) {
                    console.log(`Updating employee [${empToSave["S.No"]}]: ${emp.employee_name}`);
                    await onedrive.updateTableRow('EmployeesTable', emp.employee_id, empToSave, 'CBRE EMP ID');
                } else {
                    console.log(`Adding employee [${empToSave["S.No"]}]: ${emp.employee_name}`);
                    await onedrive.addTableRow('EmployeesTable', empToSave);
                }
                await sleep(500); 
            } catch (e) {
                console.error(`Failed to sync employee ${emp.employee_id}:`, e.message);
            }
        }

        // 2. Sync Attendance (Sheet: Timesheet - Pivoted Monthly)
        console.log("\nSyncing Timesheet (Pivoted Monthly)...");
        const uniqueMonths = await db.query("SELECT DISTINCT EXTRACT(YEAR FROM date) as year, EXTRACT(MONTH FROM date) as month FROM attendance WHERE date >= NOW() - INTERVAL '60 days'");
        
        const { syncTimesheetRow } = require('../services/api.service');
        for (const monthRow of uniqueMonths.rows) {
            const y = parseInt(monthRow.year);
            const m = parseInt(monthRow.month);
            console.log(`\nSyncing month: ${m}/${y}`);
            for (const emp of emps) {
                try {
                    console.log(`Syncing timesheet for ${emp.employee_name}...`);
                    await syncTimesheetRow(emp.employee_id, y, m);
                    await sleep(1000); // Throttling for complex pivoted updates
                } catch (e) {
                    console.error(`Failed to sync timesheet for ${emp.employee_id}:`, e.message);
                }
            }
        }

        // 3. Sync PO Sheet
        console.log("\nSyncing PO Sheet Data (Sheet: PO Sheet)...");
        const poRes = await db.query("SELECT * FROM po_sheet");
        const poRows = poRes.rows;
        const onedrivePo = await onedrive.getTableRows('POSheetTable');
        let poSno = 1;
        for (const po of poRows) {
            try {
                const poToSave = {
                    "S.No": poSno++,
                    "Emp ID (CBRE)": po.employee_id,
                    "Invoice No": po.invoice_no || '',
                    "PO Number": po.po_number || '',
                    "SOW No": po.sow_no || '',
                    "D&T Leader": po.cbre_idc_leader || '',
                    "Reporting Manager": po.reporting_manager || '',
                    "Rate Per Hour (INR)": po.rate_per_hour || '',
                    "Notes": po.notes || '',
                    "Work Location": po.work_location || ''
                };
                const existing = onedrivePo.find(p => p["Emp ID (CBRE)"] === po.employee_id);
                if (existing) {
                    await onedrive.updateTableRow('POSheetTable', po.employee_id, poToSave, 'Emp ID (CBRE)');
                } else {
                    await onedrive.addTableRow('POSheetTable', poToSave);
                }
                await sleep(500);
            } catch (e) {
                console.error(`Failed to sync PO row ${po.id}:`, e.message);
            }
        }

        // 4. Sync Automation Logs
        console.log("\nSyncing Automation Logs (Sheet: Automation Logs)...");
        const logRes = await db.query("SELECT * FROM timesheet_logs ORDER BY created_at DESC LIMIT 50");
        const logs = logRes.rows;
        const onedriveLogs = await onedrive.getTableRows('LogsTable');
        for (const log of logs) {
            try {
                console.log(`Syncing log ID: ${log.id}`);
                const logToSave = {
                    "id": log.id,
                    "File Name": log.extracted_timesheet_filename,
                    "Status": log.status,
                    "Created At": log.created_at ? (log.created_at instanceof Date ? log.created_at.toISOString() : log.created_at) : ''
                };
                const existing = onedriveLogs.find(l => String(l.id) === String(log.id));
                if (existing) {
                    await onedrive.updateTableRow('LogsTable', log.id, logToSave, 'id');
                } else {
                    await onedrive.addTableRow('LogsTable', logToSave);
                }
                await sleep(500);
            } catch (e) {
                console.error(`Failed to sync log ${log.id}:`, e.message);
            }
        }

        console.log("\n✅ Robust Sync Completed Successfully!");
        process.exit(0);
    } catch (err) {
        console.error("\n❌ Critical Sync Failure:", err);
        process.exit(1);
    }
}

syncAll();
