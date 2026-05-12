const ExcelJS = require('exceljs');
const db = require('../config/db');

const ALGOLEAP_GREEN = 'FF66BB6A'; // Light green (replaces dark #3C874B)
const WHITE = 'FFFFFFFF';
const LIGHT_GREEN = 'FFE2EFDA';
const LIGHT_GRAY = 'FFF2F2F2';
const WEEKEND_GRAY = 'FFD9D9D9';
const PH_GREEN = 'FF92D050';
const PL_RED = 'FFFF0000';
const LWP_RED = 'FFFF0000';
const BORDER_THIN = { style: 'thin', color: { argb: 'FFB4B4B4' } };

/**
 * Safely converts a PostgreSQL DATE value to 'YYYY-MM-DD' string.
 * pg returns DATE columns as JS Date objects set to local midnight.
 * IMPORTANT: Use local timezone methods (not toISOString/UTC) to avoid
 * a 1-day shift in IST (UTC+5:30) where midnight local = previous day in UTC.
 */
function toDateString(val) {
    if (val instanceof Date) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return String(val).substring(0, 10);
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Generates a multi-sheet Excel workbook for a single employee.
 * Each sheet covers one month (January through the requested month).
 * Format matches the reference timesheet layout.
 */
async function generateEmployeeTimesheetExcel(employeeId, year, throughMonth) {
    // 1. Fetch employee info from Azure PostgreSQL
    const empRes = await db.query('SELECT * FROM employees WHERE employee_id = $1', [employeeId]);
    if (empRes.rows.length === 0) throw new Error(`Employee ${employeeId} not found`);
    const empData = empRes.rows[0];

    // 2. Fetch ALL attendance from Jan 1 through end of throughMonth
    const startDate = `${year}-01-01`;
    const endDate = new Date(Date.UTC(year, throughMonth, 0)).toISOString().split('T')[0];

    const attRes = await db.query(
        'SELECT * FROM attendance WHERE employee_id = $1 AND date >= $2 AND date <= $3 ORDER BY date ASC',
        [employeeId, startDate, endDate]
    );
    const attendance = attRes.rows;

    // 3. Build attendance lookup: { 'YYYY-MM-DD': working_hours }
    const attMap = {};
    (attendance || []).forEach(r => {
        const dateKey = toDateString(r.date);
        attMap[dateKey] = r.working_hours;
    });

    console.log(`Export: Employee ${employeeId} - Found ${(attendance || []).length} attendance records from ${startDate} to ${endDate}`);
    if (attendance && attendance.length > 0) {
        console.log(`Export: Sample dates from DB (raw): ${attendance.slice(0, 3).map(a => a.date).join(', ')}`);
        console.log(`Export: Sample dates from DB (normalized): ${attendance.slice(0, 3).map(a => toDateString(a.date)).join(', ')}`);
        console.log(`Export: Sample attMap keys: ${Object.keys(attMap).slice(0, 3).join(', ')}`);
    }

    // 4. Build quarterly PL tracker: { quarterNum: totalPLs }
    // Also build monthly PL counts for the summary columns
    const monthlyPLs = {}; // { monthNum: count }
    (attendance || []).forEach(r => {
        if (typeof r.working_hours === 'string' && r.working_hours.trim().toUpperCase() === 'PL') {
            const dateStr = toDateString(r.date);
            const m = parseInt(dateStr.split('-')[1]);
            monthlyPLs[m] = (monthlyPLs[m] || 0) + 1;
        }
    });

    // 5. Create workbook with one sheet per month
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Algoleap ETMS';

    for (let m = 1; m <= throughMonth; m++) {
        const monthName = MONTH_NAMES[m - 1];
        const ws = workbook.addWorksheet(monthName);

        buildMonthSheet(ws, empData, year, m, attMap, monthlyPLs);
    }

    return workbook;
}

/**
 * Builds a single month sheet matching the reference format.
 */
function buildMonthSheet(ws, emp, year, month, attMap, monthlyPLs) {
    const daysInMonth = new Date(year, month, 0).getDate();

    // Summary columns after date columns:
    // Total Working Hours | [Month] PL Availed | Q[N] PL Availed | Total Billing hours for the month | Notes
    const SUMMARY_COL_COUNT = 5;
    const totalCols = 5 + daysInMonth + SUMMARY_COL_COUNT;

    // -- Row 1: Supplier Name header --
    ws.mergeCells(1, 1, 1, 2);
    const supplierCell = ws.getCell('A1');
    supplierCell.value = 'Supplier Name';
    supplierCell.font = { bold: true, size: 12, color: { argb: WHITE } };
    supplierCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALGOLEAP_GREEN } };
    supplierCell.alignment = { vertical: 'middle', horizontal: 'left' };
    supplierCell.border = allBorders();

    // -- Row 3-7: Presence Code Legend --
    const legendStartRow = 3;
    const pcHeaderCell = ws.getCell(legendStartRow, 2);
    pcHeaderCell.value = 'Presence Code';
    pcHeaderCell.font = { bold: true, size: 12 };
    pcHeaderCell.border = allBorders();

    // "Per Quarter 3 leaves" label
    ws.mergeCells(legendStartRow, 4, legendStartRow, 7);
    const quarterLabel = ws.getCell(legendStartRow, 4);
    quarterLabel.value = 'Per Quarter 3 leaves';
    quarterLabel.font = { bold: true, size: 12 };
    quarterLabel.alignment = { horizontal: 'left', vertical: 'middle' };

    const presenceCodes = [
        { label: 'Present', code: '8', codeColor: null, codeBg: null },
        { label: 'Public Holiday', code: 'PH', codeColor: null, codeBg: PH_GREEN },
        { label: 'Paid Leave', code: 'PL', codeColor: PL_RED, codeBg: null },
        { label: 'Leave Without Pay', code: 'LWP', codeColor: LWP_RED, codeBg: null },
        { label: 'Weekend Off', code: 'WE', codeColor: null, codeBg: null },
    ];

    presenceCodes.forEach((pc, i) => {
        const row = legendStartRow + 1 + i;
        const labelCell = ws.getCell(row, 1);
        labelCell.value = pc.label;
        labelCell.font = { size: 12 };
        labelCell.border = allBorders();

        const codeCell = ws.getCell(row, 2);
        codeCell.value = pc.code;
        codeCell.font = { bold: true, size: 12, color: pc.codeColor ? { argb: pc.codeColor } : undefined };
        if (pc.codeBg) {
            codeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pc.codeBg } };
        }
        codeCell.border = allBorders();
        codeCell.alignment = { horizontal: 'center' };
    });

    // -- Row 9: Main header row --
    const headerRow = 9;
    const dayRow = headerRow + 1;

    const fixedHeaders = ['Employee Name', 'Employee ID(CBRE)', 'Joining Date', 'Reporting Manager', 'D&T Leader'];

    fixedHeaders.forEach((h, i) => {
        const cell = ws.getCell(headerRow, i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 12, color: { argb: WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALGOLEAP_GREEN } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 0 };
        cell.border = allBorders();

        // Merge header cells across two rows for fixed columns
        ws.mergeCells(headerRow, i + 1, dayRow, i + 1);
    });

    // Date headers (rotated) + day name sub-row
    for (let d = 1; d <= daysInMonth; d++) {
        const colIdx = 5 + d;
        const dateObj = new Date(Date.UTC(year, month - 1, d));
        const dayName = DAY_NAMES[dateObj.getUTCDay()];
        const isWeekend = dateObj.getUTCDay() === 0 || dateObj.getUTCDay() === 6; // Only Sat(6) and Sun(0)

        const dateLabel = `${d}-${SHORT_MONTH_NAMES[month - 1]}`;
        const dateCell = ws.getCell(headerRow, colIdx);
        dateCell.value = dateLabel;
        dateCell.font = { bold: true, size: 10, color: { argb: WHITE } };
        dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALGOLEAP_GREEN } };
        dateCell.alignment = { vertical: 'bottom', horizontal: 'center', textRotation: 90 };
        dateCell.border = allBorders();

        const dayCell = ws.getCell(dayRow, colIdx);
        dayCell.value = dayName;
        dayCell.font = { bold: true, size: 10 };
        dayCell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: isWeekend ? WEEKEND_GRAY : LIGHT_GREEN }
        };
        dayCell.alignment = { vertical: 'middle', horizontal: 'center' };
        dayCell.border = allBorders();
    }

    // Summary column headers (after date columns)
    const summaryStartCol = 5 + daysInMonth + 1;
    const monthShortName = SHORT_MONTH_NAMES[month - 1];
    const quarterNum = month <= 3 ? 4 : month <= 6 ? 1 : month <= 9 ? 2 : 3; // Indian FY quarters
    const summaryHeaders = [
        'Total Working Hours',
        `${monthShortName} PL Availed`,
        'Q PL Availed',
        'Total Billing hours for the month',
        'Notes'
    ];

    summaryHeaders.forEach((h, i) => {
        const colIdx = summaryStartCol + i;
        const cell = ws.getCell(headerRow, colIdx);
        cell.value = h;
        cell.font = { bold: true, size: 10, color: { argb: WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALGOLEAP_GREEN } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = allBorders();

        // Merge across two rows
        ws.mergeCells(headerRow, colIdx, dayRow, colIdx);
    });

    // Set column widths
    ws.getColumn(1).width = 20;
    ws.getColumn(2).width = 18;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 20;
    ws.getColumn(5).width = 16;
    for (let d = 1; d <= daysInMonth; d++) {
        ws.getColumn(5 + d).width = 5;
    }
    // Summary column widths
    ws.getColumn(summaryStartCol).width = 18;     // Total Working Hours
    ws.getColumn(summaryStartCol + 1).width = 16;  // Month PL Availed
    ws.getColumn(summaryStartCol + 2).width = 16;  // Q PL Availed
    ws.getColumn(summaryStartCol + 3).width = 22;  // Total Billing hours
    ws.getColumn(summaryStartCol + 4).width = 16;  // Notes

    // Set row heights
    ws.getRow(headerRow).height = 55;
    ws.getRow(dayRow).height = 20;

    // -- Data Row (Row 11): Employee data --
    const dataRow = dayRow + 1;
    const empNameCell = ws.getCell(dataRow, 1);
    empNameCell.value = emp.employee_name || '';
    empNameCell.font = { size: 12 };
    empNameCell.border = allBorders();

    const empIdCell = ws.getCell(dataRow, 2);
    empIdCell.value = emp.employee_id || '';
    empIdCell.font = { size: 12 };
    empIdCell.border = allBorders();

    const joinDateCell = ws.getCell(dataRow, 3);
    joinDateCell.value = emp.joining_date || '';
    joinDateCell.font = { size: 12 };
    joinDateCell.border = allBorders();

    const managerCell = ws.getCell(dataRow, 4);
    managerCell.value = emp.reporting_manager || '';
    managerCell.font = { size: 12 };
    managerCell.border = allBorders();

    const leaderCell = ws.getCell(dataRow, 5);
    leaderCell.value = emp.dt_leader || '';
    leaderCell.font = { size: 12 };
    leaderCell.border = allBorders();

    // Calculate previous PL in quarter for quota
    let qStartMonth;
    if (month >= 1 && month <= 3) { qStartMonth = 1; }
    else if (month >= 4 && month <= 6) { qStartMonth = 4; }
    else if (month >= 7 && month <= 9) { qStartMonth = 7; }
    else { qStartMonth = 10; }

    let prevPLCount = 0;
    for (let qm = qStartMonth; qm < month; qm++) {
        prevPLCount += (monthlyPLs[qm] || 0);
    }
    let exportQuota = Math.max(0, 3 - prevPLCount);

    // Fill attendance data for each day
    let totalWorkingHours = 0;
    let monthPLCount = 0;

    for (let d = 1; d <= daysInMonth; d++) {
        const colIdx = 5 + d;
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dateObj = new Date(Date.UTC(year, month - 1, d));
        const isWeekend = dateObj.getUTCDay() === 0 || dateObj.getUTCDay() === 6; // Only Sat(6) and Sun(0)

        const rawVal = attMap[dateStr];
        const cell = ws.getCell(dataRow, colIdx);

        // Strictly mark weekends as WE
        let displayVal = '';
        if (isWeekend) {
            displayVal = 'WE';
        } else if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
            const upper = String(rawVal).trim().toUpperCase();
            if (upper === 'PH') {
                displayVal = 'PH';
            } else if (upper === 'PL') {
                if (exportQuota > 0) {
                    displayVal = 'PL';
                    exportQuota--;
                } else {
                    displayVal = 'LWP';
                }
                monthPLCount++;
            } else if (upper === 'LWP') {
                displayVal = 'LWP';
            } else if (upper === 'WFH') {
                displayVal = 8;
                totalWorkingHours += 8;
            } else if (upper === 'WE') {
                // If the DB says WE on a weekday, ignore it (it shouldn't be WE)
                displayVal = '';
            } else if (upper === '-') {
                displayVal = '';
            } else {
                const numVal = parseFloat(rawVal);
                if (!isNaN(numVal)) {
                    displayVal = numVal;
                    totalWorkingHours += numVal;
                } else {
                    displayVal = rawVal;
                }
            }
        }

        cell.value = displayVal;
        cell.font = { size: 12 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = allBorders();

        // Apply color coding
        const strVal = String(displayVal).toUpperCase();
        if (isWeekend || strVal === 'WE') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WEEKEND_GRAY } };
            cell.font = { size: 12, bold: true };
        } else if (strVal === 'PH') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PH_GREEN } };
            cell.font = { size: 12, bold: true };
        } else if (strVal === 'PL') {
            cell.font = { size: 12, bold: true, color: { argb: PL_RED } };
        } else if (strVal === 'LWP') {
            cell.font = { size: 12, bold: true, color: { argb: LWP_RED } };
        }
    }

    // Calculate quarterly PL for the summary column
    // Indian FY quarters: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
    let qEndMonth;
    if (month >= 1 && month <= 3) { qEndMonth = 3; }
    else if (month >= 4 && month <= 6) { qEndMonth = 6; }
    else if (month >= 7 && month <= 9) { qEndMonth = 9; }
    else { qEndMonth = 12; }

    let qPLTotal = 0;
    for (let qm = qStartMonth; qm <= Math.min(month, qEndMonth); qm++) {
        qPLTotal += (monthlyPLs[qm] || 0);
    }

    // Apply PL quota: max 3 per quarter
    const paidPLThisMonth = Math.min(monthPLCount, Math.max(0, 3 - (qPLTotal - monthPLCount)));
    const totalBillingHours = totalWorkingHours + (paidPLThisMonth * 8);

    // Fill summary columns
    const twCell = ws.getCell(dataRow, summaryStartCol);
    twCell.value = totalWorkingHours;
    twCell.font = { size: 12, bold: true };
    twCell.alignment = { horizontal: 'center', vertical: 'middle' };
    twCell.border = allBorders();

    const plCell = ws.getCell(dataRow, summaryStartCol + 1);
    plCell.value = paidPLThisMonth || 0;
    plCell.font = { size: 12, bold: true, color: paidPLThisMonth > 0 ? { argb: PL_RED } : undefined };
    plCell.alignment = { horizontal: 'center', vertical: 'middle' };
    plCell.border = allBorders();

    const qplCell = ws.getCell(dataRow, summaryStartCol + 2);
    qplCell.value = qPLTotal;
    qplCell.font = { size: 12, bold: true };
    qplCell.alignment = { horizontal: 'center', vertical: 'middle' };
    qplCell.border = allBorders();

    const tbCell = ws.getCell(dataRow, summaryStartCol + 3);
    tbCell.value = totalBillingHours;
    tbCell.font = { size: 12, bold: true, color: { argb: ALGOLEAP_GREEN } };
    tbCell.alignment = { horizontal: 'center', vertical: 'middle' };
    tbCell.border = allBorders();

    const notesCell = ws.getCell(dataRow, summaryStartCol + 4);
    notesCell.value = '';
    notesCell.font = { size: 12 };
    notesCell.alignment = { horizontal: 'center', vertical: 'middle' };
    notesCell.border = allBorders();
}

/**
 * Helper: returns a full border object for all 4 sides.
 */
function allBorders() {
    return {
        top: BORDER_THIN,
        left: BORDER_THIN,
        bottom: BORDER_THIN,
        right: BORDER_THIN,
    };
}

module.exports = {
    generateEmployeeTimesheetExcel,
};
