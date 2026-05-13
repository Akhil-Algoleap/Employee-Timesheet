const onedrive = require('./onedrive.service');
const db = require('../config/db');

/**
 * Fetches all attendance records joined with employee data for a specific year and month.
 */
async function getAttendanceData(year, month) {
    try {
        // Query database instead of OneDrive
        const empRes = await db.query('SELECT * FROM employees ORDER BY employee_name');
        const employees = empRes.rows;
        const empIdSet = new Set(employees.map(e => e.employee_id));

        const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
        const quarterStartDate = `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`;
        const currentMonthStartDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const currentMonthEndDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        // Fetch attendance for the specific month from DB
        const attRes = await db.query(
            'SELECT * FROM attendance WHERE employee_id = ANY($1) AND date >= $2 AND date <= $3',
            [employees.map(e => e.employee_id), quarterStartDate, currentMonthEndDate]
        );
        const allAttendance = attRes.rows;

        // Fetch PO sheet data from DB
        const poRes = await db.query(
            'SELECT * FROM po_sheet WHERE year = $1 AND month = $2',
            [year, month]
        );
        const poRows = poRes.rows;

        const joinedData = employees.map(emp => {
            const empAttendance = allAttendance.filter(a => a.employee_id === emp.employee_id);
            
            const currentMonthAttendance = empAttendance.filter(a => {
                const d = a.date instanceof Date ? a.date.toISOString().split('T')[0] : a.date;
                return d >= currentMonthStartDate && d <= currentMonthEndDate;
            });
            
            const previousQuarterAttendance = empAttendance.filter(a => {
                const d = a.date instanceof Date ? a.date.toISOString().split('T')[0] : a.date;
                return d >= quarterStartDate && d < currentMonthStartDate;
            });

            const previous_pl_in_quarter = previousQuarterAttendance.reduce((acc, curr) => {
                if (curr.working_hours && typeof curr.working_hours === 'string') {
                    if (curr.working_hours.trim().toUpperCase() === 'PL') return acc + 1;
                }
                return acc;
            }, 0);

            const po = (poRows || []).find(p => p.employee_id === emp.employee_id) || {};
            const dtLeader = emp.dt_leader || po.cbre_idc_leader || '';

            return {
                ...emp,
                email: emp.email || '',
                billing_category: emp.billing_category || 'No',
                dt_leader: dtLeader,
                approved: 'No',
                previous_pl_in_quarter,
                is_finalized: po.is_finalized === 'true' || po.is_finalized === true,
                received_via_email: po.received_via_email === 'true' || po.received_via_email === true,
                attendance: currentMonthAttendance
            };
        });

        // Compute mismatched records (attendance without employee record)
        const mismatchedRes = await db.query(
            'SELECT employee_id, COUNT(*) as record_count FROM attendance WHERE date >= $1 AND date <= $2 GROUP BY employee_id',
            [currentMonthStartDate, currentMonthEndDate]
        );
        const mismatched = mismatchedRes.rows.filter(r => !empIdSet.has(r.employee_id));

        return { employees: joinedData, mismatched };
    } catch (error) {
        console.error("Error fetching attendance data from Database:", error);
        throw error;
    }
}

async function getTimesheetLogs() {
    try {
        const res = await db.query('SELECT * FROM timesheet_logs ORDER BY created_at DESC LIMIT 100');
        return res.rows;
    } catch (error) {
        console.error("Error fetching timesheet logs from Database:", error);
        throw error;
    }
}

async function getAllEmployees() {
    try {
        const res = await db.query('SELECT * FROM employees ORDER BY employee_name');
        return res.rows;
    } catch (error) {
        console.error("Error fetching all employees from Database:", error);
        throw error;
    }
}

async function saveEmployeeData(employeeData) {
    try {
        const { attendance, approved, ...empData } = employeeData;

        // 1. Upsert employee in DB
        const empQuery = `
            INSERT INTO employees (employee_id, employee_name, joining_date, reporting_manager, dt_leader, client, email, billing_category)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (employee_id) DO UPDATE SET
                employee_name = EXCLUDED.employee_name,
                joining_date = EXCLUDED.joining_date,
                reporting_manager = EXCLUDED.reporting_manager,
                dt_leader = EXCLUDED.dt_leader,
                client = EXCLUDED.client,
                email = EXCLUDED.email,
                billing_category = EXCLUDED.billing_category;
        `;
        await db.query(empQuery, [
            empData.employee_id,
            empData.employee_name,
            empData.joining_date || null,
            empData.reporting_manager || null,
            empData.dt_leader || null,
            empData.client || 'CBRE',
            empData.email || null,
            empData.billing_category || 'No'
        ]);

        // 2. Sync Employee to OneDrive - Match exact column names
        const empToSave = {
            "Name": empData.employee_name,
            "CBRE EMP ID": empData.employee_id,
            "Joining Date": empData.joining_date || '',
            "Email": empData.email || '',
            "D&T Leader": empData.dt_leader || '',
            "Reporting Manager": empData.reporting_manager || '',
            "Client": empData.client || 'CBRE',
            "Billing Category": empData.billing_category || 'No'
        };
        
        onedrive.getTableRows('EmployeesTable').then(employees => {
            const existing = employees.find(e => e["CBRE EMP ID"] === empData.employee_id);
            if (existing) onedrive.updateTableRow('EmployeesTable', empData.employee_id, empToSave, 'CBRE EMP ID');
            else onedrive.addTableRow('EmployeesTable', { "S.No": employees.length + 1, ...empToSave });
        }).catch(err => console.error("OneDrive Employee Sync Error:", err));

        // 3. Upsert attendance in DB
        if (attendance && attendance.length > 0) {
            for (const record of attendance) {
                const attQuery = `
                    INSERT INTO attendance (employee_id, date, day, working_hours)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (employee_id, date) DO UPDATE SET
                        day = EXCLUDED.day,
                        working_hours = EXCLUDED.working_hours;
                `;
                await db.query(attQuery, [empData.employee_id, record.date, record.day, record.working_hours]);
            }
            
            // If we have year/month, trigger the monthly row sync for OneDrive
            if (employeeData.year && employeeData.month) {
                syncTimesheetRow(empData.employee_id, employeeData.year, employeeData.month);
            }
        }

        return { success: true };
    } catch (error) {
        console.error("Error saving employee data:", error);
        throw error;
    }
}

async function getPOSheetData(year, month) {
    try {
        const qStart = month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
        const qMonths = [qStart, qStart + 1, qStart + 2];
        const quarterStartDate = `${year}-${String(qStart).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const mEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
        const mStart = `${year}-${String(month).padStart(2, '0')}-01`;

        const employees = (await db.query('SELECT * FROM employees ORDER BY employee_name')).rows;
        const allAtt = (await db.query('SELECT * FROM attendance WHERE date >= $1 AND date <= $2', [quarterStartDate, mEnd])).rows;
        const poRows = (await db.query('SELECT * FROM po_sheet WHERE year = $1 AND month = $2', [year, month])).rows;

        const attMap = {};
        const prevAttMap = {};
        const qLeaveMap = {};

        (allAtt || []).forEach(r => {
            const rDateStr = r.date instanceof Date ? r.date.toISOString().split('T')[0] : r.date;
            if (rDateStr >= mStart && rDateStr <= mEnd) {
                (attMap[r.employee_id] = attMap[r.employee_id] || []).push(r);
            } else if (rDateStr >= quarterStartDate && rDateStr < mStart) {
                (prevAttMap[r.employee_id] = prevAttMap[r.employee_id] || []).push(r);
            }
            
            if (rDateStr >= quarterStartDate && rDateStr <= mEnd) {
                const upperHours = typeof r.working_hours === 'string' ? r.working_hours.trim().toUpperCase() : '';
                if (upperHours === 'PL' || upperHours === 'LWP') {
                    const m = parseInt(rDateStr.split('-')[1]);
                    qLeaveMap[r.employee_id] = qLeaveMap[r.employee_id] || {};
                    qLeaveMap[r.employee_id][m] = (qLeaveMap[r.employee_id][m] || 0) + 1;
                }
            }
        });

        return employees
            .filter(emp => (attMap[emp.employee_id] || []).length > 0)
            .map((emp, idx) => {
                const att = attMap[emp.employee_id] || [];
                const prevAtt = prevAttMap[emp.employee_id] || [];
                const po = poRows.find(r => r.employee_id === emp.employee_id) || {};

                const totalHours = att.reduce((s, r) => s + (parseFloat(r.working_hours) || 0), 0);
                const previous_pl_in_quarter = prevAtt.reduce((acc, r) => {
                    if (typeof r.working_hours === 'string' && r.working_hours.trim().toUpperCase() === 'PL') return acc + 1;
                    return acc;
                }, 0);

                const monthPL = att.filter(r => typeof r.working_hours === 'string' && r.working_hours.trim().toUpperCase() === 'PL').length;
                const remainingQuota = Math.max(0, 3 - previous_pl_in_quarter);
                const paidPL = Math.min(monthPL, remainingQuota);
                const totalBillingHours = totalHours + paidPL * 8;

                const ratePerHour = parseFloat(po.rate_per_hour) || 0;
                const gstPct = parseFloat(po.gst) || 0;
                const billingAmtNoGST = totalBillingHours * ratePerHour;
                const gstAmt = billingAmtNoGST * gstPct / 100;

                const empQLeavesMap = qLeaveMap[emp.employee_id] || {};
                const qLeavesList = qMonths.map(m => empQLeavesMap[m] || 0);
                const totalQLeaves = qLeavesList.reduce((a, b) => a + b, 0);
                const qLeaveBalance = totalQLeaves - 3;

                const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'short' });
                const monthYearLabel = `${monthName}'${String(year).slice(-2)}`;
                const leaveDates = att
                    .filter(r => {
                        const val = typeof r.working_hours === 'string' ? r.working_hours.trim().toUpperCase() : '';
                        return val === 'PL' || val === 'LWP';
                    })
                    .map(r => (r.date instanceof Date ? r.date.toISOString().split('T')[0] : r.date).split('-')[2])
                    .join(', ');

                return {
                    sno: idx + 1,
                    employee_id: emp.employee_id,
                    employee_name: emp.employee_name,
                    reporting_manager: emp.reporting_manager || '',
                    dt_leader: emp.dt_leader || po.cbre_idc_leader || '',
                    total_hours: totalHours,
                    pl_availed: paidPL,
                    total_billing_hours: totalBillingHours,
                    billing_amt_no_gst: billingAmtNoGST,
                    gst_amount: gstAmt,
                    total_billed: billingAmtNoGST + gstAmt,
                    quarter_months: qMonths,
                    quarter_leaves: qLeavesList,
                    q_leave_balance: qLeaveBalance,
                    pl_dates: leaveDates ? `${monthYearLabel}: ${leaveDates}` : '-',
                    invoice_no: po.invoice_no || '',
                    po_number: po.po_number || '',
                    sow_no: po.sow_no || '',
                    cbre_idc_leader: po.cbre_idc_leader || '',
                    rate_per_hour: po.rate_per_hour || '',
                    gst: po.gst ?? 18,
                    timesheet_received: po.timesheet_received || '',
                    timesheet_verified: po.timesheet_verified || '',
                    timesheet_sent_to_cbre: po.timesheet_sent_to_cbre || '',
                    notes: po.notes || '',
                    work_location: po.work_location || '',
                    resource_type: po.resource_type || '',
                    vendor_name: po.vendor_name || 'Algoleap',
                    exits: po.exits || '',
                    is_finalized: po.is_finalized === 'true' || po.is_finalized === true,
                };
            });
    } catch (error) {
        console.error('Error fetching PO Sheet data:', error);
        throw error;
    }
}

async function savePOSheetRow(data) {
    try {
        // 1. Upsert in DB
        const poQuery = `
            INSERT INTO po_sheet (id, employee_id, year, month, invoice_no, po_number, sow_no, cbre_idc_leader, rate_per_hour, gst, timesheet_received, timesheet_verified, timesheet_sent_to_cbre, approvals, notes, work_location, resource_type, vendor_name, exits, is_finalized, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW())
            ON CONFLICT (id) DO UPDATE SET
                invoice_no = EXCLUDED.invoice_no,
                po_number = EXCLUDED.po_number,
                sow_no = EXCLUDED.sow_no,
                cbre_idc_leader = EXCLUDED.cbre_idc_leader,
                rate_per_hour = EXCLUDED.rate_per_hour,
                gst = EXCLUDED.gst,
                timesheet_received = EXCLUDED.timesheet_received,
                timesheet_verified = EXCLUDED.timesheet_verified,
                timesheet_sent_to_cbre = EXCLUDED.timesheet_sent_to_cbre,
                approvals = EXCLUDED.approvals,
                notes = EXCLUDED.notes,
                work_location = EXCLUDED.work_location,
                resource_type = EXCLUDED.resource_type,
                vendor_name = EXCLUDED.vendor_name,
                exits = EXCLUDED.exits,
                is_finalized = EXCLUDED.is_finalized,
                updated_at = NOW();
        `;
        const compositeId = `${data.employee_id}_${data.year}_${data.month}`;
        await db.query(poQuery, [
            compositeId, data.employee_id, data.year, data.month,
            data.invoice_no || '', data.po_number || '', data.sow_no || '', data.cbre_idc_leader || '',
            data.rate_per_hour || '', data.gst ?? 18, data.timesheet_received || '', data.timesheet_verified || '',
            data.timesheet_sent_to_cbre || '', data.approvals || '', data.notes || '',
            data.work_location || '', data.resource_type || '', data.vendor_name || 'Algoleap',
            data.exits || '', data.is_finalized ? true : false
        ]);

        // 2. Sync to OneDrive - Match exact column names from image
        const poToSave = {
            "Emp ID (CBRE)": data.employee_id,
            "Resource Name": data.employee_name || '',
            "Invoice No": data.invoice_no || '',
            "PO Number": data.po_number || '',
            "SOW No": data.sow_no || '',
            "D&T Leader": data.cbre_idc_leader || '',
            "Reporting Manager": data.reporting_manager || '',
            "Rate Per Hour (INR)": data.rate_per_hour || '',
            "Notes": data.notes || '',
            "Work Location": data.work_location || '',
            "Total Working Hours": data.total_hours || '',
            "PL Availed": data.pl_availed || '',
            "Total Billing Hours": data.total_billing_hours || '',
            "Total Billing Amt (W/O GST)": data.billing_amt_no_gst || '',
            "Timesheet Sent to CBRE": data.timesheet_sent_to_cbre || ''
        };
        onedrive.getTableRows('POSheetTable').then(poRows => {
            const existing = poRows.find(p => p["Emp ID (CBRE)"] === data.employee_id);
            if (existing) onedrive.updateTableRow('POSheetTable', data.employee_id, poToSave, 'Emp ID (CBRE)');
            else onedrive.addTableRow('POSheetTable', { "S.No": poRows.length + 1, ...poToSave });
        }).catch(err => console.error("OneDrive PO Sync Error:", err));

        return { success: true };
    } catch (error) {
        console.error('Error saving PO Sheet row:', error);
        throw error;
    }
}

async function deleteEmployee(employee_id) {
    try {
        await db.query('DELETE FROM employees WHERE employee_id = $1', [employee_id]);
        onedrive.deleteTableRow('EmployeesTable', employee_id, 'employee_id').catch(err => console.error("OneDrive Delete Error:", err));
        return { success: true };
    } catch (error) {
        console.error('Error deleting employee:', error);
        throw error;
    }
}

async function getTimesheetStatus(year, month) {
    try {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const employees = (await db.query('SELECT * FROM employees ORDER BY employee_name')).rows;
        const empIdSet = new Set(employees.map(e => e.employee_id));

        const attRes = await db.query('SELECT employee_id FROM attendance WHERE date >= $1 AND date <= $2', [startDate, endDate]);
        const currentMonthAtt = attRes.rows;
        const attendanceIds = new Set(currentMonthAtt.map(r => r.employee_id));

        const received = employees.filter(e => attendanceIds.has(e.employee_id));
        const pending = employees.filter(e => !attendanceIds.has(e.employee_id));

        const mismatchedIds = [...attendanceIds].filter(id => !empIdSet.has(id));
        const mismatched = mismatchedIds.map(id => {
            const count = currentMonthAtt.filter(a => a.employee_id === id).length;
            return { employee_id: id, record_count: count };
        });

        return { received, mismatched, pending };
    } catch (error) {
        console.error('Error computing timesheet status:', error);
        throw error;
    }
}

async function syncTimesheetRow(employee_id, year, month) {
    try {
        const emp = (await db.query('SELECT * FROM employees WHERE employee_id = $1', [employee_id])).rows[0];
        if (!emp) return;

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const att = (await db.query('SELECT * FROM attendance WHERE employee_id = $1 AND date >= $2 AND date <= $3', [employee_id, startDate, endDate])).rows;

        const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
        
        const row = {
            "Employee Name": emp.employee_name,
            "Employee ID": emp.employee_id,
            "Joining Date": emp.joining_date || '',
            "Reporting Manager": emp.reporting_manager || '',
            "D&T Leader": emp.dt_leader || '',
            "Client": emp.client || 'CBRE',
            "Billing Category": emp.billing_category || 'No',
            "Month": `${monthName} ${year}`
        };

        let totalHours = 0;
        let plAvailed = 0;
        let lwp = 0;

        for (let i = 1; i <= daysInMonth; i++) {
            const d = new Date(year, month - 1, i);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const dayName = d.toLocaleString('default', { weekday: 'short' });
            const colName = `${i}-${dayName}`;
            
            const record = att.find(r => {
                const rDate = new Date(r.date);
                const rDateStr = `${rDate.getFullYear()}-${String(rDate.getMonth() + 1).padStart(2, '0')}-${String(rDate.getDate()).padStart(2, '0')}`;
                return rDateStr === dateStr;
            });

            if (record) {
                row[colName] = record.working_hours;
                const hrs = parseFloat(record.working_hours);
                if (!isNaN(hrs)) totalHours += hrs;
                else if (record.working_hours === 'PL') plAvailed++;
                else if (record.working_hours === 'LWP') lwp++;
            } else {
                row[colName] = '';
            }
        }

        row["Total Hours"] = totalHours;
        row["PL Availed"] = plAvailed;
        row["LWP"] = lwp;
        row["Total Billing hours"] = totalHours + (plAvailed * 8); // Assuming 8 hrs for PL

        const compositeId = `${employee_id}_${year}_${month}`;
        onedrive.getTableRows('AttendanceTable').then(rows => {
            const existing = rows.find(r => r.id === compositeId);
            if (existing) onedrive.updateTableRow('AttendanceTable', compositeId, row, 'id');
            else onedrive.addTableRow('AttendanceTable', { "id": compositeId, ...row });
        }).catch(err => console.error("OneDrive Timesheet Sync Error:", err));

    } catch (error) {
        console.error("Error syncing timesheet row:", error);
    }
}

module.exports = {
    getAttendanceData,
    getTimesheetLogs,
    getAllEmployees,
    saveEmployeeData,
    getPOSheetData,
    savePOSheetRow,
    deleteEmployee,
    getTimesheetStatus,
    syncTimesheetRow
};
