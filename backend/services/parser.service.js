const xlsx = require('xlsx');
const db = require('../config/db');
const onedrive = require('./onedrive.service');
const { containerClient } = require('../config/storage');

/**
 * Main parser entry point.
 */
async function parseTimesheet(job) {
    // 1. Download from Azure Storage
    console.log(`Parser: Downloading ${job.storage_path} from Azure...`);
    const blobClient = containerClient.getBlobClient(job.storage_path);
    const downloadBlockBlobResponse = await blobClient.download();
    
    // Helper to convert stream to buffer
    const streamToBuffer = async (readableStream) => {
        return new Promise((resolve, reject) => {
            const chunks = [];
            readableStream.on("data", (data) => {
                chunks.push(data instanceof Buffer ? data : Buffer.from(data));
            });
            readableStream.on("end", () => {
                resolve(Buffer.concat(chunks));
            });
            readableStream.on("error", reject);
        });
    };

    const buffer = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);
    
    // 2. Load Workbook
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    
    let rows = [];
    let candidates = [];

    let targetYear = job.target_year || new Date().getFullYear();
    let targetMonth = job.target_month || null;

    if (job.received_at) {
        const receivedDate = new Date(job.received_at);
        const dayOfMonth = receivedDate.getUTCDate();
        if (dayOfMonth >= 20) {
            targetMonth = receivedDate.getUTCMonth() + 1;
            targetYear = receivedDate.getUTCFullYear();
        } else {
            targetMonth = receivedDate.getUTCMonth(); // previous month
            targetYear = receivedDate.getUTCFullYear();
            if (targetMonth === 0) {
                targetMonth = 12;
                targetYear -= 1;
            }
        }
        console.log(`Parser: Dynamic target month determined as ${targetMonth}/${targetYear} (Submission day: ${dayOfMonth})`);
    } else if (!job.target_year && job.filename) {
        const match = job.filename.match(/(?:20)\d{2}/);
        if (match) {
            targetYear = parseInt(match[0], 10);
            console.log(`Parser: Detected year ${targetYear} from filename ${job.filename}`);
        }
    }
    
    // --- STEP 1: Pre-seed PL counts from DB (ONLY from finalized months) ---
    const preExistingPLs = {};
    const seedClient = await db.pool.connect();
    try {
        const plQuery = `
            SELECT a.employee_id, EXTRACT(MONTH FROM a.date) as month, COUNT(*) as count
            FROM attendance a
            JOIN po_sheet p ON a.employee_id = p.employee_id 
                AND EXTRACT(YEAR FROM a.date) = p.year 
                AND EXTRACT(MONTH FROM a.date) = p.month
            WHERE EXTRACT(YEAR FROM a.date) = $1 
              AND a.working_hours = 'PL'
              AND p.is_finalized = TRUE
            GROUP BY a.employee_id, EXTRACT(MONTH FROM a.date)
        `;
        const plRes = await seedClient.query(plQuery, [targetYear]);
        plRes.rows.forEach(r => {
            const empId = r.employee_id;
            const month = parseInt(r.month);
            const count = parseInt(r.count);
            if (!preExistingPLs[empId]) preExistingPLs[empId] = {};
            preExistingPLs[empId][month] = count;
        });
    } catch (e) {
        console.error("Parser: Error fetching pre-existing PLs:", e);
    } finally {
        seedClient.release();
    }
    // ------------------------------------------

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const sheetRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
        if (!sheetRows || sheetRows.length < 5) continue;

        let tempHeaderIndex = -1;
        let tempColOffset = 0;

        for (let i = 0; i < 20; i++) {
            const row = sheetRows[i];
            if (!row) continue;
            const colIndex = row.findIndex(cell => cell && String(cell).includes('Employee Name') && !String(cell).includes(':'));
            if (colIndex !== -1 && row.length > 10) {
                tempHeaderIndex = i;
                tempColOffset = colIndex;
                break;
            }
        }

        if (tempHeaderIndex !== -1) {
            let dataCount = 0;
            const testRows = sheetRows.slice(tempHeaderIndex + 2, tempHeaderIndex + 15);
            testRows.forEach(r => {
                if (r && (String(r[tempColOffset] || '').trim().length > 1 || String(r[tempColOffset + 1] || '').trim().length > 1)) {
                    dataCount++;
                }
            });

            candidates.push({
                name: sheetName,
                rows: sheetRows,
                headerIndex: tempHeaderIndex,
                colOffset: tempColOffset,
                dataCount
            });
        }
    }

    if (candidates.length === 0) throw new Error("Could not find a valid timesheet header in any sheet.");
    
    console.log(`Parser: Found ${candidates.length} candidate sheets. Processing all...`);

    for (const best of candidates) {
        const rows = best.rows;
        const headerRowIndex = best.headerIndex;
        const colOffset = best.colOffset;
        const targetSheetName = best.name;

        let globalMeta = { name: null, id: null, joiningDate: null, manager: null, leader: null, client: null };

        for (let i = 0; i < 15; i++) {
            const row = rows[i];
            if (!row) continue;
            row.forEach((cell, idx) => {
                if (!cell) return;
                const str = String(cell).toLowerCase().trim();
                const val = row[idx + 1];
                if (str.includes('employee name:')) globalMeta.name = val;
                if (str.includes('employee id:')) globalMeta.id = val;
                if (str.includes('reporting manager:')) globalMeta.manager = val;
                if (str.includes('dt leader:')) globalMeta.leader = val;
                if (str.includes('joining date:')) globalMeta.joiningDate = val;
            });
        }

        console.log(`Parser: Processing sheet '${targetSheetName}' [Data Rows: ${best.dataCount}]`);

        const row1 = rows[headerRowIndex]; 
        const row2 = rows[headerRowIndex + 1]; 
        
        let clientColIndex = -1;
        for (let i = 0; i < 15; i++) {
            const r = rows[i];
            if (!r) continue;
            const idx = r.findIndex(cell => cell && /client/i.test(String(cell)));
            if (idx !== -1) {
                clientColIndex = idx;
                break;
            }
        }

        const sheetEmployees = [];
        const sheetAttendance = [];

        const dataRows = rows.slice(headerRowIndex + 2);

        const dateIntervals = [];
        const datePattern = /^\d{2}-[A-Za-z]{3}$/;

        for (let i = colOffset + 5; i < row1.length; i++) {
            const cell = row1[i];
            let dateVal = null;

            if (cell && typeof cell === 'string' && datePattern.test(cell.trim())) {
                dateVal = parseExcelStringDate(cell.trim(), targetYear, targetMonth);
            } else if (cell && typeof cell === 'number' && cell > 40000) {
                dateVal = excelSerialToDate(cell, targetYear, targetMonth);
            }

            if (dateVal) {
                dateIntervals.push({
                    colIndex: i,
                    dateValue: dateVal,
                    dayLabel: row2[i] || ''
                });
            }
        }

        if (dateIntervals.length === 0) {
            console.log(`Parser: Skipping sheet '${targetSheetName}' as no date columns were found.`);
            continue;
        }

        // Determine sheet month/quarter
        const sheetDateObj = new Date(dateIntervals[0].dateValue);
        const sheetYearVal = sheetDateObj.getUTCFullYear();
        const sheetMonth = sheetDateObj.getUTCMonth() + 1;
        
        if (targetMonth !== null && (sheetMonth !== targetMonth || sheetYearVal !== targetYear)) {
            console.log(`Parser: Skipping sheet '${targetSheetName}' (Month ${sheetMonth}/${sheetYearVal} doesn't match target ${targetMonth}/${targetYear})`);
            continue;
        }
        
        const sheetQuarter = Math.ceil(sheetMonth / 3);
        const startMonth = (sheetQuarter - 1) * 3 + 1;

        const plTracker = {}; // Local to this sheet

        let lastSeenEmployee = {
            name: globalMeta.name,
            id: globalMeta.id,
            joiningDate: globalMeta.joiningDate,
            manager: globalMeta.manager,
            leader: globalMeta.leader,
            client: null,
            clientColIndex: clientColIndex
        };

        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            if (!row || row.length === 0) continue;
            
            const rowName = row[colOffset];
            const rowIdRaw = row[colOffset + 1];
            const rowId = String(rowIdRaw || '').trim();

            const isNewEmployeeRow = (rowName && String(rowName).trim().length > 1) || (rowId && rowId.length > 2);
            
            if (isNewEmployeeRow) {
                lastSeenEmployee = {
                    name: rowName ? String(rowName).trim() : lastSeenEmployee.name,
                    id: rowId && rowId.length > 2 ? rowId : lastSeenEmployee.id,
                    joiningDate: row[colOffset + 2] || lastSeenEmployee.joiningDate,
                    manager: row[colOffset + 3] || lastSeenEmployee.manager,
                    leader: row[colOffset + 4] || lastSeenEmployee.leader,
                    client: (lastSeenEmployee.clientColIndex !== -1 && row[lastSeenEmployee.clientColIndex]) ? String(row[lastSeenEmployee.clientColIndex]).trim() : lastSeenEmployee.client
                };

                const employeeId = lastSeenEmployee.id;
                const employeeName = lastSeenEmployee.name;

                if (employeeId && employeeId !== 'null' && employeeName) {
                    sheetEmployees.push({
                        employee_id: employeeId,
                        employee_name: employeeName,
                        joining_date: formatDatabaseDate(lastSeenEmployee.joiningDate, targetYear),
                        reporting_manager: lastSeenEmployee.manager ? String(lastSeenEmployee.manager).trim() : null,
                        dt_leader: lastSeenEmployee.leader ? String(lastSeenEmployee.leader).trim() : null,
                        client: lastSeenEmployee.client ? String(lastSeenEmployee.client).trim() : null
                    });
                }
            }

            const employeeId = lastSeenEmployee.id;
            const employeeName = lastSeenEmployee.name;
            // Skip attendance rows when employee identity was never established
            // (prevents silently attributing data to the wrong person)
            if (!employeeId || employeeId === 'null' || !employeeName) continue;

            const trackingKey = `${employeeId}_${sheetYearVal}_Q${sheetQuarter}`;
            if (plTracker[trackingKey] === undefined) {
                let priorPLCount = 0;
                if (preExistingPLs[employeeId]) {
                    for (let m = startMonth; m < sheetMonth; m++) {
                        priorPLCount += (preExistingPLs[employeeId][m] || 0);
                    }
                }
                plTracker[trackingKey] = priorPLCount;
            }

            for (const interval of dateIntervals) {
                const hours = row[interval.colIndex];
                if (hours !== null && hours !== undefined && String(hours).trim() !== '') {
                    let rawHours = String(hours).trim();
                    const upperHours = rawHours.toUpperCase();

                    if (upperHours === 'PL') {
                        if (plTracker[trackingKey] >= 3) {
                            rawHours = 'LWP';
                        } else {
                            plTracker[trackingKey]++;
                            rawHours = 'PL'; 
                        }
                    } else if (upperHours === 'PH' || upperHours === 'WE' || upperHours === 'LWP') {
                        rawHours = upperHours; 
                    }

                    sheetAttendance.push({
                        employee_id: employeeId,
                        date: interval.dateValue,
                        day: interval.dayLabel,
                        working_hours: rawHours
                    });
                }
            }
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // --- STEP 0: Fetch valid employee IDs and finalized status ---
            const existingEmpRes = await client.query('SELECT employee_id FROM employees');
            const validEmpIds = new Set(existingEmpRes.rows.map(r => r.employee_id));
            
            const finalizedRes = await client.query('SELECT employee_id FROM po_sheet WHERE year = $1 AND month = $2 AND is_finalized = TRUE', [sheetYearVal, sheetMonth]);
            const finalizedEmpIds = new Set(finalizedRes.rows.map(r => r.employee_id));

            // Filter attendance to ONLY include valid employees AND non-finalized employees
            const validSheetAttendance = sheetAttendance.filter(item => validEmpIds.has(item.employee_id) && !finalizedEmpIds.has(item.employee_id));
            // ----------------------------------------------------------------------------------

            if (validSheetAttendance.length > 0) {
                // --- STEP 2: Delete existing rows for this month's date range for these employees ---
                const minDate = dateIntervals[0].dateValue;
                const maxDate = dateIntervals[dateIntervals.length - 1].dateValue;
                
                const uniqueEmpIds = Array.from(new Set(validSheetAttendance.map(item => item.employee_id)));
                
                if (uniqueEmpIds.length > 0) {
                    const deleteQuery = `
                        DELETE FROM attendance 
                        WHERE date >= $1 AND date <= $2 
                        AND employee_id = ANY($3)
                    `;
                    await client.query(deleteQuery, [minDate, maxDate, uniqueEmpIds]);
                }
                // ----------------------------------------------------------------------------------

                const uniqueAttendance = Array.from(
                    new Map(validSheetAttendance.map(item => [`${item.employee_id}_${item.date}`, item])).values()
                );
                
                for (const att of uniqueAttendance) {
                    const query = `
                        INSERT INTO attendance (employee_id, date, day, working_hours)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (employee_id, date) 
                        DO UPDATE SET 
                            day = EXCLUDED.day,
                            working_hours = EXCLUDED.working_hours;
                    `;
                    await client.query(query, [att.employee_id, att.date, att.day, att.working_hours]);
                }
                console.log(`Parser: Sheet '${targetSheetName}' - Saved to Azure.`);

                // Mark as received via email in po_sheet
                if (uniqueEmpIds.length > 0) {
                    const poUpdateQuery = `
                        INSERT INTO po_sheet (employee_id, year, month, received_via_email)
                        SELECT unnest($1::text[]), $2, $3, TRUE
                        ON CONFLICT (employee_id, year, month)
                        DO UPDATE SET received_via_email = TRUE
                    `;
                    await client.query(poUpdateQuery, [uniqueEmpIds, sheetYearVal, sheetMonth]);
                }

                // --- Update preExistingPLs for subsequent sheets in the same file ---
                uniqueEmpIds.forEach(empId => {
                    if (preExistingPLs[empId]) preExistingPLs[empId][sheetMonth] = 0;
                });
                for (const att of uniqueAttendance) {
                    if (att.working_hours === 'PL') {
                        const empId = att.employee_id;
                        if (!preExistingPLs[empId]) preExistingPLs[empId] = {};
                        preExistingPLs[empId][sheetMonth] = (preExistingPLs[empId][sheetMonth] || 0) + 1;
                    }
                }
                // --------------------------------------------------------------------
            }

            await client.query('COMMIT');

            // --- Real-time Mirror to OneDrive ---
            try {
                // 1. Sync Employees
                for (const emp of sheetEmployees) {
                    const empToSave = {
                        employee_id: emp.employee_id,
                        employee_name: emp.employee_name,
                        joining_date: emp.joining_date || '',
                        reporting_manager: emp.reporting_manager || '',
                        dt_leader: emp.dt_leader || '',
                        client: emp.client || 'CBRE',
                        email: emp.email || '',
                        billing_category: emp.billing_category || 'No'
                    };
                    onedrive.getTableRows('EmployeesTable').then(rows => {
                        const existing = rows.find(r => r.employee_id === emp.employee_id);
                        if (existing) onedrive.updateTableRow('EmployeesTable', emp.employee_id, empToSave, 'employee_id');
                        else onedrive.addTableRow('EmployeesTable', empToSave);
                    }).catch(e => console.error(`Sync Employee ${emp.employee_id} fail:`, e.message));
                }

                // 2. Sync Attendance
                const onedriveAtt = await onedrive.getTableRows('AttendanceTable');
                for (const att of uniqueAttendance) {
                    const attId = `${att.employee_id}_${att.date}`;
                    const attToSave = {
                        id: attId,
                        employee_id: att.employee_id,
                        date: att.date,
                        day: att.day,
                        working_hours: att.working_hours
                    };
                    const existing = onedriveAtt.find(r => r.id === attId);
                    if (existing) {
                        // Only update if working_hours changed
                        if (existing.working_hours !== att.working_hours) {
                            onedrive.updateTableRow('AttendanceTable', attId, attToSave, 'id').catch(e => {});
                        }
                    } else {
                        onedrive.addTableRow('AttendanceTable', attToSave).catch(e => {});
                    }
                }
            } catch (syncError) {
                console.error("OneDrive Sync Failure (non-fatal):", syncError.message);
            }
            // ------------------------------------
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(`Parser: Error processing sheet ${targetSheetName}:`, e.message);
        } finally {
            client.release();
        }
    }
}

/**
 * Helpers
 */
function formatDatabaseDate(val, targetYear) {
    if (!val) return null;
    try {
        if (typeof val === 'number') return excelSerialToDate(val, targetYear);
        const d = new Date(val);
        if (isNaN(d.getTime())) return null;
        
        // Preserve the original date as-is (including its year).
        // Do NOT overwrite with targetYear — that corrupts real joining dates.
        return d.toISOString().split('T')[0];
    } catch (e) { return null; }
}

function parseExcelStringDate(label, targetYear, forceMonth = null) {
    const yearToUse = targetYear || new Date().getFullYear(); 
    const [day, monthStr] = label.split('-');
    const months = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };
    
    let monthIndex = months[monthStr];
    if (forceMonth !== null) {
        monthIndex = forceMonth - 1; // 1-indexed to 0-indexed
    }

    const date = new Date(Date.UTC(yearToUse, monthIndex, parseInt(day)));
    return date.toISOString().split('T')[0];
}

function excelSerialToDate(serial, targetYear, forceMonth = null) {
    const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
    const y = targetYear || date.getUTCFullYear();
    let m = date.getUTCMonth(); // 0-indexed
    let day = date.getUTCDate();
    
    if (forceMonth !== null) {
        m = forceMonth - 1;
        // Clamp the day to the forced month's max length
        // (e.g. serial decodes to day 31, but forced month is Feb → clamp to 28/29)
        const maxDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        if (day > maxDay) day = maxDay;
    }
    
    const mm = String(m + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
}

module.exports = {
    parseTimesheet
};
