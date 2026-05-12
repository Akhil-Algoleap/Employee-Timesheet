const onedrive = require('./onedrive.service');

/**
 * Fetches all attendance records joined with employee data for a specific year and month.
 */
async function getAttendanceData(year, month) {
    try {
        const employees = await onedrive.getTableRows('EmployeesTable');
        const empIdSet = new Set(employees.map(e => e.employee_id));

        const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
        const quarterStartDate = `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`;
        const currentMonthStartDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const currentMonthEndDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const allAttendance = await onedrive.getTableRows('AttendanceTable');
        const poRows = await onedrive.getTableRows('POSheetTable');

        const joinedData = employees.map(emp => {
            const empAttendance = allAttendance.filter(a => a.employee_id === emp.employee_id);
            
            const currentMonthAttendance = empAttendance.filter(a => {
                const d = a.date;
                return d >= currentMonthStartDate && d <= currentMonthEndDate;
            });
            
            const previousQuarterAttendance = empAttendance.filter(a => {
                const d = a.date;
                return d >= quarterStartDate && d < currentMonthStartDate;
            });

            const previous_pl_in_quarter = previousQuarterAttendance.reduce((acc, curr) => {
                if (curr.working_hours && typeof curr.working_hours === 'string') {
                    if (curr.working_hours.trim().toUpperCase() === 'PL') return acc + 1;
                }
                return acc;
            }, 0);

            const po = (poRows || []).find(p => p.employee_id === emp.employee_id && parseInt(p.year) === year && parseInt(p.month) === month) || {};
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

        const currentMonthAttAll = allAttendance.filter(a => {
            const d = a.date;
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
        console.error("Error fetching attendance data from OneDrive:", error);
        throw error;
    }
}

async function getTimesheetLogs() {
    try {
        return await onedrive.getTableRows('LogsTable');
    } catch (error) {
        console.error("Error fetching timesheet logs from OneDrive:", error);
        throw error;
    }
}

async function getAllEmployees() {
    try {
        const emps = await onedrive.getTableRows('EmployeesTable');
        return emps.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
    } catch (error) {
        console.error("Error fetching all employees from OneDrive:", error);
        throw error;
    }
}

async function saveEmployeeData(employeeData) {
    try {
        const { attendance, approved, ...empData } = employeeData;

        // 1. Upsert employee
        const employees = await onedrive.getTableRows('EmployeesTable');
        const existingEmp = employees.find(e => e.employee_id === empData.employee_id);
        
        const empToSave = {
            employee_id: empData.employee_id,
            employee_name: empData.employee_name,
            joining_date: empData.joining_date || '',
            reporting_manager: empData.reporting_manager || '',
            dt_leader: empData.dt_leader || '',
            client: empData.client || 'CBRE',
            email: empData.email || '',
            billing_category: empData.billing_category || 'No'
        };

        if (existingEmp) {
            await onedrive.updateTableRow('EmployeesTable', empData.employee_id, empToSave, 'employee_id');
        } else {
            await onedrive.addTableRow('EmployeesTable', empToSave);
        }

        // 2. Upsert attendance
        if (attendance && attendance.length > 0) {
            const allAtt = await onedrive.getTableRows('AttendanceTable');
            for (const record of attendance) {
                const existingAtt = allAtt.find(a => a.employee_id === empData.employee_id && a.date === record.date);
                const attToSave = {
                    employee_id: empData.employee_id,
                    date: record.date,
                    day: record.day,
                    working_hours: record.working_hours
                };
                const compositeId = `${empData.employee_id}_${record.date}`;
                attToSave.id = compositeId;

                if (existingAtt) {
                    await onedrive.updateTableRow('AttendanceTable', compositeId, attToSave, 'id');
                } else {
                    await onedrive.addTableRow('AttendanceTable', attToSave);
                }
            }
        }

        if (employeeData.year && employeeData.month) {
            const poRows = await onedrive.getTableRows('POSheetTable');
            const compositeId = `${empData.employee_id}_${employeeData.year}_${employeeData.month}`;
            const existingPo = poRows.find(p => p.id === compositeId);
            
            const poToSave = {
                id: compositeId,
                employee_id: empData.employee_id,
                year: employeeData.year,
                month: employeeData.month,
                is_finalized: employeeData.is_finalized ? 'true' : 'false',
                updated_at: new Date().toISOString()
            };

            if (existingPo) {
                await onedrive.updateTableRow('POSheetTable', compositeId, poToSave, 'id');
            } else {
                await onedrive.addTableRow('POSheetTable', poToSave);
            }
        }

        return { success: true };
    } catch (error) {
        console.error("Error saving employee data to OneDrive:", error);
        throw error;
    }
}

async function getPOSheetData(year, month) {
    try {
        const qStart = month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
        const qMonths = [qStart, qStart + 1, qStart + 2];

        const employees = await onedrive.getTableRows('EmployeesTable');
        const allAtt = await onedrive.getTableRows('AttendanceTable');
        const poRows = await onedrive.getTableRows('POSheetTable');

        const quarterStartDate = `${year}-${String(qStart).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const mEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
        const mStart = `${year}-${String(month).padStart(2, '0')}-01`;

        const attMap = {};
        const prevAttMap = {};
        const qLeaveMap = {};

        (allAtt || []).forEach(r => {
            const rDateStr = r.date;
            if (rDateStr >= mStart && rDateStr <= mEnd) {
                (attMap[r.employee_id] = attMap[r.employee_id] || []).push(r);
            } else if (rDateStr >= quarterStartDate && rDateStr < mStart) {
                (prevAttMap[r.employee_id] = prevAttMap[r.employee_id] || []).push(r);
            }
            
            if (rDateStr >= quarterStartDate && rDateStr <= mEnd) {
                const upperHours = typeof r.working_hours === 'string' ? r.working_hours.trim().toUpperCase() : '';
                if (upperHours === 'PL' || upperHours === 'LWP') {
                    const m = parseInt(r.date.split('-')[1]);
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
                const po = poRows.find(r => r.employee_id === emp.employee_id && parseInt(r.year) === year && parseInt(r.month) === month) || {};

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
                    .map(r => r.date.split('-')[2])
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
        console.error('Error fetching PO Sheet data from OneDrive:', error);
        throw error;
    }
}

async function savePOSheetRow(data) {
    try {
        const poRows = await onedrive.getTableRows('POSheetTable');
        const compositeId = `${data.employee_id}_${data.year}_${data.month}`;
        const existingPo = poRows.find(p => p.id === compositeId);

        const poToSave = {
            id: compositeId,
            employee_id: data.employee_id,
            year: data.year,
            month: data.month,
            invoice_no: data.invoice_no || '',
            po_number: data.po_number || '',
            sow_no: data.sow_no || '',
            cbre_idc_leader: data.cbre_idc_leader || '',
            rate_per_hour: data.rate_per_hour || '',
            gst: data.gst ?? 18,
            timesheet_received: data.timesheet_received || '',
            timesheet_verified: data.timesheet_verified || '',
            timesheet_sent_to_cbre: data.timesheet_sent_to_cbre || '',
            approvals: data.approvals || '',
            notes: data.notes || '',
            work_location: data.work_location || '',
            resource_type: data.resource_type || '',
            vendor_name: data.vendor_name || 'Algoleap',
            exits: data.exits || '',
            is_finalized: data.is_finalized ? 'true' : 'false',
            updated_at: new Date().toISOString()
        };

        if (existingPo) {
            await onedrive.updateTableRow('POSheetTable', compositeId, poToSave, 'id');
        } else {
            await onedrive.addTableRow('POSheetTable', poToSave);
        }
        return { success: true };
    } catch (error) {
        console.error('Error saving PO Sheet row to OneDrive:', error);
        throw error;
    }
}

async function deleteEmployee(employee_id) {
    try {
        await onedrive.deleteTableRow('EmployeesTable', employee_id, 'employee_id');
        return { success: true };
    } catch (error) {
        console.error('Error deleting employee from OneDrive:', error);
        throw error;
    }
}

async function getTimesheetStatus(year, month) {
    try {
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const employees = await onedrive.getTableRows('EmployeesTable');
        const empIdSet = new Set(employees.map(e => e.employee_id));

        const allAtt = await onedrive.getTableRows('AttendanceTable');
        const currentMonthAtt = allAtt.filter(a => a.date >= startDate && a.date <= endDate);
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
        console.error('Error computing timesheet status from OneDrive:', error);
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
