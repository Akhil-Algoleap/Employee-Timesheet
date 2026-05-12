const db = require('../config/db');

/**
 * Fetches all attendance records joined with employee data for a specific year and month.
 */
async function getAttendanceData(year, month) {
    try {
        // Fetch all employees
        const empRes = await db.query('SELECT * FROM employees');
        const employees = empRes.rows;
        const empIdSet = new Set(employees.map(e => e.employee_id));

        // Calculate date ranges
        const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
        const quarterStartDate = `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`;
        const currentMonthStartDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const currentMonthEndDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        // Fetch attendance for the quarter
        const attRes = await db.query(
            'SELECT * FROM attendance WHERE date >= $1 AND date <= $2',
            [quarterStartDate, currentMonthEndDate]
        );
        const attendance = attRes.rows;

        // Fetch PO sheet data for the "approved" status
        const poRes = await db.query(
            'SELECT employee_id, cbre_idc_leader, is_finalized, received_via_email FROM po_sheet WHERE year = $1 AND month = $2',
            [year, month]
        );
        const poRows = poRes.rows;

        // Map attendance to employees
        const joinedData = employees.map(emp => {
            const empAttendance = attendance.filter(a => a.employee_id === emp.employee_id);
            const currentMonthAttendance = empAttendance.filter(a => {
                const dateObj = new Date(a.date);
                const d = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
                return d >= currentMonthStartDate && d <= currentMonthEndDate;
            });
            
            const previousQuarterAttendance = empAttendance.filter(a => {
                const dateObj = new Date(a.date);
                const d = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
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
                approved: 'No', // Hardcoded as approvals are removed
                previous_pl_in_quarter,
                is_finalized: po.is_finalized || false,
                received_via_email: po.received_via_email || false,
                attendance: currentMonthAttendance
            };
        });

        // Detect mismatched: attendance IDs in this month that don't match any employee record
        const currentMonthAttAll = attendance.filter(a => {
            const dateObj = new Date(a.date);
            const d = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
            return d >= currentMonthStartDate && d <= currentMonthEndDate;
        });
        const mismatchedMap = {};
        currentMonthAttAll.forEach(a => {
            if (!empIdSet.has(a.employee_id)) {
                if (!mismatchedMap[a.employee_id]) mismatchedMap[a.employee_id] = 0;
                mismatchedMap[a.employee_id]++;
            }
        });
        const mismatched = Object.entries(mismatchedMap).map(([id, count]) => ({
            employee_id: id,
            record_count: count
        }));

        return { employees: joinedData, mismatched };
    } catch (error) {
        console.error("Error fetching attendance data from Azure:", error);
        throw error;
    }
}

/**
 * Fetches timesheet logs with sorting.
 */
async function getTimesheetLogs() {
    try {
        const res = await db.query('SELECT * FROM timesheet_logs ORDER BY id ASC');
        return res.rows;
    } catch (error) {
        console.error("Error fetching timesheet logs from Azure:", error);
        throw error;
    }
}

async function getAllEmployees() {
    try {
        const res = await db.query('SELECT * FROM employees ORDER BY employee_name ASC');
        return res.rows;
    } catch (error) {
        console.error("Error fetching all employees from Azure:", error);
        throw error;
    }
}

async function saveEmployeeData(employeeData) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        const { attendance, approved, ...empData } = employeeData;

        // 1. Upsert employee
        const upsertEmpQuery = `
            INSERT INTO employees (employee_id, employee_name, joining_date, reporting_manager, dt_leader, client, email, billing_category)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (employee_id) 
            DO UPDATE SET 
                employee_name = EXCLUDED.employee_name,
                joining_date = EXCLUDED.joining_date,
                reporting_manager = EXCLUDED.reporting_manager,
                dt_leader = EXCLUDED.dt_leader,
                client = EXCLUDED.client,
                email = EXCLUDED.email,
                billing_category = EXCLUDED.billing_category;
        `;
        await client.query(upsertEmpQuery, [
            empData.employee_id, 
            empData.employee_name, 
            empData.joining_date || null, 
            empData.reporting_manager || null, 
            empData.dt_leader || null, 
            empData.client || 'CBRE',
            empData.email || null,
            empData.billing_category || 'No'
        ]);

        // 2. Upsert attendance
        if (attendance && attendance.length > 0) {
            for (const record of attendance) {
                const upsertAttQuery = `
                    INSERT INTO attendance (employee_id, date, day, working_hours)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (employee_id, date) 
                    DO UPDATE SET 
                        day = EXCLUDED.day,
                        working_hours = EXCLUDED.working_hours;
                `;
                await client.query(upsertAttQuery, [empData.employee_id, record.date, record.day, record.working_hours]);
            }
        }

        if (employeeData.year && employeeData.month) {
            const upsertPoQuery = `
                INSERT INTO po_sheet (employee_id, year, month, is_finalized, updated_at)
                VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                ON CONFLICT (employee_id, year, month) 
                DO UPDATE SET 
                    is_finalized = EXCLUDED.is_finalized,
                    updated_at = EXCLUDED.updated_at;
            `;
            await client.query(upsertPoQuery, [empData.employee_id, employeeData.year, employeeData.month, Boolean(employeeData.is_finalized)]);
        }

        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error saving employee data to Azure:", error);
        throw error;
    } finally {
        client.release();
    }
}

async function getPOSheetData(year, month) {
    try {
        const qStart = month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
        const qMonths = [qStart, qStart + 1, qStart + 2];

        const empRes = await db.query('SELECT employee_id, employee_name, reporting_manager, dt_leader, client FROM employees');
        const employees = empRes.rows;

        const quarterStartDate = `${year}-${String(qStart).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const mEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
        const mStart = `${year}-${String(month).padStart(2, '0')}-01`;

        const attRes = await db.query('SELECT * FROM attendance WHERE date >= $1 AND date <= $2', [quarterStartDate, mEnd]);
        const allAtt = attRes.rows;

        const poRes = await db.query('SELECT * FROM po_sheet WHERE year = $1 AND month = $2', [year, month]);
        const poRows = poRes.rows;

        const attMap = {};
        const prevAttMap = {};
        const qLeaveMap = {};

        (allAtt || []).forEach(r => {
            const dateObj = new Date(r.date);
            const rDateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
            if (rDateStr >= mStart && rDateStr <= mEnd) {
                (attMap[r.employee_id] = attMap[r.employee_id] || []).push(r);
            } else {
                (prevAttMap[r.employee_id] = prevAttMap[r.employee_id] || []).push(r);
            }
            const upperHours = typeof r.working_hours === 'string' ? r.working_hours.trim().toUpperCase() : '';
            if (upperHours === 'PL' || upperHours === 'LWP') {
                const m = new Date(r.date).getMonth() + 1;
                qLeaveMap[r.employee_id] = qLeaveMap[r.employee_id] || {};
                qLeaveMap[r.employee_id][m] = (qLeaveMap[r.employee_id][m] || 0) + 1;
            }
        });

        return employees
            .filter(emp => (attMap[emp.employee_id] || []).length > 0)
            .map((emp, idx) => {
                const att = attMap[emp.employee_id] || [];
                const prevAtt = prevAttMap[emp.employee_id] || [];
                const po = (poRows || []).find(r => r.employee_id === emp.employee_id) || {};

                const totalHours = att.reduce((s, r) => s + (parseFloat(r.working_hours) || 0), 0);
                const previous_pl_in_quarter = prevAtt.reduce((acc, r) => {
                    if (typeof r.working_hours === 'string' && r.working_hours.trim().toUpperCase() === 'PL') return acc + 1;
                    return acc;
                }, 0);

                const monthPL = att.filter(r => typeof r.working_hours === 'string' && r.working_hours.trim().toUpperCase() === 'PL').length;
                const monthLWP = att.filter(r => typeof r.working_hours === 'string' && r.working_hours.trim().toUpperCase() === 'LWP').length;
                
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
                    .map(r => new Date(r.date).getDate())
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
                    is_finalized: po.is_finalized || false,
                };
            });
    } catch (error) {
        console.error('Error fetching PO Sheet data from Azure:', error);
        throw error;
    }
}

async function savePOSheetRow(data) {
    try {
        const query = `
            INSERT INTO po_sheet (
                employee_id, year, month, invoice_no, po_number, sow_no,
                cbre_idc_leader, rate_per_hour, gst, timesheet_received,
                timesheet_verified, timesheet_sent_to_cbre, approvals,
                notes, work_location, resource_type, vendor_name, exits, is_finalized, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP
            )
            ON CONFLICT (employee_id, year, month) 
            DO UPDATE SET 
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
                updated_at = CURRENT_TIMESTAMP;
        `;
        const values = [
            data.employee_id, data.year, data.month, data.invoice_no, data.po_number, data.sow_no,
            data.cbre_idc_leader, data.rate_per_hour, data.gst, data.timesheet_received,
            data.timesheet_verified, data.timesheet_sent_to_cbre, data.approvals,
            data.notes, data.work_location, data.resource_type, data.vendor_name, data.exits, Boolean(data.is_finalized)
        ];
        await db.query(query, values);
        return { success: true };
    } catch (error) {
        console.error('Error saving PO Sheet row to Azure:', error);
        throw error;
    }
}

async function deleteEmployee(employee_id) {
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM attendance WHERE employee_id = $1', [employee_id]);
        await client.query('DELETE FROM po_sheet WHERE employee_id = $1', [employee_id]);
        await client.query('DELETE FROM employees WHERE employee_id = $1', [employee_id]);
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting employee from Azure:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Computes timesheet status for a given month/year:
 *   - received:   employees in the DB whose attendance data exists for the period
 *   - mismatched: employee_ids in attendance that don't match any employee record
 *   - pending:    employees in the DB who have NO attendance data for the period
 */
async function getTimesheetStatus(year, month) {
    try {
        const daysInMonth = new Date(year, month, 0).getDate();
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        // All registered employees
        const empRes = await db.query('SELECT employee_id, employee_name, email, reporting_manager, dt_leader FROM employees ORDER BY employee_name ASC');
        const employees = empRes.rows;
        const empIdSet = new Set(employees.map(e => e.employee_id));

        // All distinct employee_ids that have attendance rows in this period
        const attRes = await db.query(
            'SELECT DISTINCT employee_id FROM attendance WHERE date >= $1 AND date <= $2',
            [startDate, endDate]
        );
        const attendanceIds = new Set(attRes.rows.map(r => r.employee_id));

        // Received: employees whose ID exists in both employees table AND attendance
        const received = employees.filter(e => attendanceIds.has(e.employee_id));

        // Pending: employees whose ID exists in employees table but NOT in attendance
        const pending = employees.filter(e => !attendanceIds.has(e.employee_id));

        // Mismatched: employee_ids in attendance that are NOT in the employees table
        const mismatchedIds = [...attendanceIds].filter(id => !empIdSet.has(id));
        // For mismatched, try to get the name from attendance or just return the ID
        const mismatched = [];
        for (const id of mismatchedIds) {
            // Try to get at least one row to show some context
            const rowRes = await db.query(
                'SELECT employee_id, COUNT(*) as record_count FROM attendance WHERE employee_id = $1 AND date >= $2 AND date <= $3 GROUP BY employee_id',
                [id, startDate, endDate]
            );
            mismatched.push({
                employee_id: id,
                record_count: rowRes.rows[0]?.record_count || 0
            });
        }

        return { received, mismatched, pending };
    } catch (error) {
        console.error('Error computing timesheet status:', error);
        throw error;
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
    getTimesheetStatus
};
