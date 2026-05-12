const db = require('../config/db');
const onedrive = require('../services/onedrive.service');

async function syncAll() {
    try {
        console.log("🚀 Starting Full Sync: Database -> OneDrive...");

        // 1. Sync Employees
        console.log("\nSyncing Employees...");
        const emps = (await db.query('SELECT * FROM employees')).rows;
        const onedriveEmps = await onedrive.getTableRows('EmployeesTable');
        for (const emp of emps) {
            const empToSave = {
                employee_id: emp.employee_id,
                employee_name: emp.employee_name,
                joining_date: emp.joining_date ? (emp.joining_date instanceof Date ? emp.joining_date.toISOString().split('T')[0] : emp.joining_date) : '',
                reporting_manager: emp.reporting_manager || '',
                dt_leader: emp.dt_leader || '',
                client: emp.client || 'CBRE',
                email: emp.email || '',
                billing_category: emp.billing_category || 'No'
            };
            const existing = onedriveEmps.find(e => e.employee_id === emp.employee_id);
            if (existing) {
                console.log(`Updating employee: ${emp.employee_name}`);
                await onedrive.updateTableRow('EmployeesTable', emp.employee_id, empToSave, 'employee_id');
            } else {
                console.log(`Adding employee: ${emp.employee_name}`);
                await onedrive.addTableRow('EmployeesTable', empToSave);
            }
        }

        // 2. Sync Attendance (Last 2 months to avoid overwhelming Graph API)
        console.log("\nSyncing Attendance (Last 60 days)...");
        const attRes = await db.query("SELECT * FROM attendance WHERE date >= NOW() - INTERVAL '60 days'");
        const atts = attRes.rows;
        const onedriveAtt = await onedrive.getTableRows('AttendanceTable');
        for (const att of atts) {
            const dateStr = att.date instanceof Date ? att.date.toISOString().split('T')[0] : att.date;
            const attId = `${att.employee_id}_${dateStr}`;
            const attToSave = {
                id: attId,
                employee_id: att.employee_id,
                date: dateStr,
                day: att.day,
                working_hours: att.working_hours
            };
            const existing = onedriveAtt.find(a => a.id === attId);
            if (!existing) {
                console.log(`Adding attendance: ${attId}`);
                await onedrive.addTableRow('AttendanceTable', attToSave);
            } else if (existing.working_hours !== att.working_hours) {
                console.log(`Updating attendance: ${attId}`);
                await onedrive.updateTableRow('AttendanceTable', attId, attToSave, 'id');
            }
        }

        // 3. Sync PO Sheet
        console.log("\nSyncing PO Sheet Data...");
        const poRes = await db.query("SELECT * FROM po_sheet");
        const poRows = poRes.rows;
        const onedrivePo = await onedrive.getTableRows('POSheetTable');
        for (const po of poRows) {
            const poToSave = {
                id: po.id,
                employee_id: po.employee_id,
                year: po.year,
                month: po.month,
                invoice_no: po.invoice_no || '',
                po_number: po.po_number || '',
                sow_no: po.sow_no || '',
                cbre_idc_leader: po.cbre_idc_leader || '',
                rate_per_hour: po.rate_per_hour || '',
                gst: po.gst ?? 18,
                timesheet_received: po.timesheet_received || '',
                timesheet_verified: po.timesheet_verified || '',
                timesheet_sent_to_cbre: po.timesheet_sent_to_cbre || '',
                approvals: po.approvals || '',
                notes: po.notes || '',
                work_location: po.work_location || '',
                resource_type: po.resource_type || '',
                vendor_name: po.vendor_name || 'Algoleap',
                exits: po.exits || '',
                is_finalized: po.is_finalized ? 'true' : 'false',
                updated_at: po.updated_at instanceof Date ? po.updated_at.toISOString() : new Date().toISOString()
            };
            const existing = onedrivePo.find(p => p.id === po.id);
            if (existing) {
                await onedrive.updateTableRow('POSheetTable', po.id, poToSave, 'id');
            } else {
                await onedrive.addTableRow('POSheetTable', poToSave);
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
