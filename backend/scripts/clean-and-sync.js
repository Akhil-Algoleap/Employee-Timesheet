/**
 * CLEAN-AND-SYNC: Clears all data rows in each OneDrive sheet,
 * then repopulates them from the database with correct S.No and field mapping.
 */

const db = require('../config/db');
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DRIVE_ID = process.env.ONEDRIVE_DRIVE_ID;
const ITEM_ID = process.env.ONEDRIVE_ITEM_ID;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getAccessToken = async () => {
    const params = new URLSearchParams();
    params.append('client_id', process.env.AZURE_CLIENT_ID);
    params.append('client_secret', process.env.AZURE_CLIENT_SECRET);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', process.env.ONEDRIVE_REFRESH_TOKEN);
    params.append('scope', 'https://graph.microsoft.com/Files.ReadWrite offline_access');
    const response = await fetch(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
        method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = await response.json();
    if (data.error) throw new Error(`${data.error}: ${data.error_description}`);
    return data.access_token;
};

const getClient = async () => {
    const token = await getAccessToken();
    return Client.init({ authProvider: (done) => done(null, token) });
};

/**
 * Reads the header row and clears all data rows in a sheet.
 */
const clearSheetData = async (client, sheetName) => {
    const res = await client
        .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/usedRange`)
        .get();
    const values = res.values;
    if (!values || values.length <= 1) {
        console.log(`  "${sheetName}" has no data rows to clear.`);
        return values ? values[0] : [];
    }
    const headers = values[0];
    const dataRowCount = values.length - 1;
    // Clear from row 2 downward
    const endCol = colToLetter(headers.length - 1);
    const clearRange = `A2:${endCol}${values.length}`;
    await client
        .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/range(address='${clearRange}')/clear`)
        .post({ applyTo: 'Contents' });
    console.log(`  Cleared ${dataRowCount} data rows from "${sheetName}".`);
    return headers;
};

/**
 * Writes a single row of data to a specific row number in the sheet.
 */
const writeRow = async (client, sheetName, rowNum, headers, data) => {
    const normalizedData = {};
    Object.keys(data).forEach(k => { normalizedData[k.trim().toLowerCase()] = data[k]; });
    const normalizedHeaders = headers.map(h => (h ?? '').toString().trim().toLowerCase());
    const rowValues = normalizedHeaders.map(h => normalizedData[h] ?? '');
    const endCol = colToLetter(headers.length - 1);
    const range = `A${rowNum}:${endCol}${rowNum}`;
    await client
        .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/range(address='${range}')`)
        .patch({ values: [rowValues] });
};

const colToLetter = (col) => {
    let letter = '';
    col += 1;
    while (col > 0) {
        const rem = (col - 1) % 26;
        letter = String.fromCharCode(65 + rem) + letter;
        col = Math.floor((col - 1) / 26);
    }
    return letter;
};

async function cleanAndSync() {
    try {
        console.log('🧹 Starting Clean-and-Sync: OneDrive Excel will be fully reset from DB...\n');
        const client = await getClient();
        const emps = (await db.query('SELECT * FROM employees ORDER BY employee_name')).rows;

        // ─── 1. EMPLOYEE DETAILS ─────────────────────────────────────────────────
        console.log('Step 1: Clearing Employee Details sheet...');
        const empHeaders = await clearSheetData(client, 'Employee Details');
        await sleep(1000);
        console.log(`Step 1: Writing ${emps.length} employee rows...`);
        let sno = 1;
        for (const emp of emps) {
            const row = {
                "S.No": sno++,
                "Name": emp.employee_name,
                "CBRE EMP ID": emp.employee_id,
                "Joining Date": emp.joining_date
                    ? (emp.joining_date instanceof Date ? emp.joining_date.toISOString().split('T')[0] : String(emp.joining_date).split('T')[0])
                    : '',
                "Email": emp.email || '',
                "D&T Leader": emp.dt_leader || '',
                "Reporting Manager": emp.reporting_manager || '',
                "Client": emp.client || 'CBRE',
                "Billing Category": emp.billing_category || 'No'
            };
            try {
                await writeRow(client, 'Employee Details', sno, empHeaders, row); // sno was incremented, so it equals row number (1-indexed data = row 2+)
                await sleep(300);
                process.stdout.write(`\r  Written: ${sno - 1}/${emps.length} employees`);
            } catch (e) {
                console.error(`\n  Failed employee ${emp.employee_id}:`, e.message);
            }
        }
        console.log('\n✅ Employee Details done.\n');

        // ─── 2. PO SHEET ─────────────────────────────────────────────────────────
        console.log('Step 2: Clearing PO Sheet...');
        const poHeaders = await clearSheetData(client, 'PO Sheet');
        await sleep(1000);
        const poRes = await db.query('SELECT * FROM po_sheet ORDER BY employee_id, year, month');
        console.log(`Step 2: Writing ${poRes.rows.length} PO rows...`);
        let poSno = 1;
        for (const po of poRes.rows) {
            const empInfo = emps.find(e => e.employee_id === po.employee_id);
            const row = {
                "S.No": poSno++,
                "Resource Name": empInfo ? empInfo.employee_name : '',
                "Emp ID (CBRE)": po.employee_id,
                "Invoice No": po.invoice_no || '',
                "PO Number": po.po_number || '',
                "SOW No": po.sow_no || '',
                "Reporting Manager": empInfo ? empInfo.reporting_manager : '',
                "D&T Leader": po.cbre_idc_leader || '',
                "Total Working Hours": po.total_hours || '',
                "PL Availed": po.pl_availed || '',
                "Total Billing Hours": po.total_billing_hours || '',
                "Rate Per Hour (INR)": po.rate_per_hour || '',
                "Total Billing Amt (W/O GST)": po.billing_amt_no_gst || '',
                "Timesheet Sent to CBRE": po.timesheet_sent_to_cbre || '',
                "Notes": po.notes || '',
                "Work Location": po.work_location || '',
                "Resource Type": po.resource_type || '',
                "Vendor Name": po.vendor_name || 'Algoleap'
            };
            try {
                await writeRow(client, 'PO Sheet', poSno + 1, poHeaders, row); // +1 for header row
                await sleep(300);
                process.stdout.write(`\r  Written: ${poSno - 1}/${poRes.rows.length} PO rows`);
            } catch (e) {
                console.error(`\n  Failed PO ${po.employee_id}:`, e.message);
            }
        }
        console.log('\n✅ PO Sheet done.\n');

        // ─── 3. AUTOMATION LOGS ───────────────────────────────────────────────────
        console.log('Step 3: Clearing Automation Logs...');
        const logHeaders = await clearSheetData(client, 'Automation Logs');
        await sleep(500);
        const logRes = await db.query('SELECT * FROM timesheet_logs ORDER BY created_at DESC LIMIT 100');
        console.log(`Step 3: Writing ${logRes.rows.length} log rows...`);
        for (let i = 0; i < logRes.rows.length; i++) {
            const log = logRes.rows[i];
            const row = {
                "id": log.id,
                "File Name": log.extracted_timesheet_filename,
                "Status": log.status,
                "Created At": log.created_at ? log.created_at.toISOString() : ''
            };
            try {
                await writeRow(client, 'Automation Logs', i + 2, logHeaders, row); // +2 = header + 1-indexed
                await sleep(200);
            } catch (e) {
                console.error(`  Failed log ${log.id}:`, e.message);
            }
        }
        console.log(`✅ Automation Logs done (${logRes.rows.length} entries).\n`);

        console.log('🎉 Clean-and-Sync completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Fatal Error:', err.message);
        process.exit(1);
    }
}

cleanAndSync();
