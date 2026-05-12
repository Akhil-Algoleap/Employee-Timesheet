const db = require('../config/db');
const onedrive = require('../services/onedrive.service');

async function syncAll() {
    try {
        console.log("🚀 Starting Full Sync: Database -> OneDrive (Spec: Image Columns)...");

        // 1. Sync Employees
        console.log("\nSyncing Employees (Sheet: Employee Details)...");
        const emps = (await db.query('SELECT * FROM employees')).rows;
        const onedriveEmps = await onedrive.getTableRows('EmployeesTable');
        for (const emp of emps) {
            const empToSave = {
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
                console.log(`Updating employee: ${emp.employee_name}`);
                await onedrive.updateTableRow('EmployeesTable', emp.employee_id, empToSave, 'CBRE EMP ID');
            } else {
                console.log(`Adding employee: ${emp.employee_name}`);
                await onedrive.addTableRow('EmployeesTable', { "S.No": onedriveEmps.length + 1, ...empToSave });
            }
        }

        // 2. Sync Attendance (Sheet: Timesheet - Pivoted Monthly)
        console.log("\nSyncing Timesheet (Pivoted Monthly)...");
        const uniqueMonths = await db.query("SELECT DISTINCT EXTRACT(YEAR FROM date) as year, EXTRACT(MONTH FROM date) as month FROM attendance WHERE date >= NOW() - INTERVAL '60 days'");
        
        const { syncTimesheetRow } = require('../services/api.service');
        for (const monthRow of uniqueMonths.rows) {
            const y = parseInt(monthRow.year);
            const m = parseInt(monthRow.month);
            console.log(`Syncing month: ${m}/${y}`);
            for (const emp of emps) {
                await syncTimesheetRow(emp.employee_id, y, m);
            }
        }

        // 3. Sync PO Sheet
        console.log("\nSyncing PO Sheet Data...");
        const poRes = await db.query("SELECT * FROM po_sheet");
        const poRows = poRes.rows;
        const onedrivePo = await onedrive.getTableRows('POSheetTable');
        for (const po of poRows) {
            const poToSave = {
                "Emp ID": po.employee_id,
                "Invoice No": po.invoice_no || '',
                "PO Number": po.po_number || '',
                "SOW No": po.sow_no || '',
                "D&T Leader": po.cbre_idc_leader || '',
                "Reporting Manager": po.reporting_manager || '',
                "Rate Per Hour": po.rate_per_hour || '',
                "Notes": po.notes || '',
                "Work Location": po.work_location || '',
                "is_finalized": po.is_finalized ? 'true' : 'false'
            };
            const existing = onedrivePo.find(p => p.id === po.id);
            if (existing) {
                await onedrive.updateTableRow('POSheetTable', po.id, poToSave, 'id');
            } else {
                await onedrive.addTableRow('POSheetTable', { "No": onedrivePo.length + 1, "id": po.id, ...poToSave });
            }
        }

        console.log("\n✅ Sync Completed Successfully!");
        process.exit(0);
    } catch (err) {
        console.error("\n❌ Sync Failed:", err);
        process.exit(1);
    }
}

syncAll();
