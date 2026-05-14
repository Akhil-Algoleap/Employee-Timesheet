const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Credentials from Environment Variables
const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const DRIVE_ID = process.env.ONEDRIVE_DRIVE_ID;
const ITEM_ID = process.env.ONEDRIVE_ITEM_ID;
const REFRESH_TOKEN = process.env.ONEDRIVE_REFRESH_TOKEN;

// Map table names to sheet names
const SHEET_MAP = {
  'EmployeesTable': 'Employee Details',
  'AttendanceTable': 'Timesheet',
  'POSheetTable': 'PO Sheet',
  'LogsTable': 'Automation Logs',
};

const getAccessToken = async () => {
  if (!REFRESH_TOKEN) throw new Error('ONEDRIVE_REFRESH_TOKEN is missing');
  
  const params = new URLSearchParams();
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', REFRESH_TOKEN);
  params.append('scope', 'https://graph.microsoft.com/Files.ReadWrite offline_access');

  const response = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const data = await response.json();
  if (data.error) throw new Error(`${data.error}: ${data.error_description}`);
  return data.access_token;
};

const getGraphClient = async () => {
  const token = await getAccessToken();
  return Client.init({
    authProvider: (done) => done(null, token),
  });
};

const getSheetName = (tableName) => {
  const sheet = SHEET_MAP[tableName];
  if (!sheet) throw new Error(`Unknown table name: ${tableName}`);
  return sheet;
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

const normalizeHeaders = (rawHeaders) => {
  return rawHeaders.map((h) => {
    const str = (h ?? '').toString().trim().toLowerCase();
    // Keep 'id' as 'id', others are trimmed and lowercased
    return str;
  });
};

const getTableRows = async (tableName) => {
  const sheetName = getSheetName(tableName);
  const client = await getGraphClient();
  
  const res = await client
    .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/usedRange`)
    .get();

  const values = res.values;
  if (!values || values.length < 2) return [];

  const headers = normalizeHeaders(values[0]);
  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
};

const addTableRow = async (tableName, data) => {
  const sheetName = getSheetName(tableName);
  const client = await getGraphClient();

  const headerRes = await client
    .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/usedRange`)
    .get();

  const values = headerRes.values;
  if (!values || values.length === 0) throw new Error(`Sheet "${sheetName}" is empty`);

  const headers = normalizeHeaders(values[0]);

  // Normalize incoming data keys to lowercase so they match normalized headers
  const normalizedData = {};
  Object.keys(data).forEach(k => { normalizedData[k.trim().toLowerCase()] = data[k]; });

  const newRow = headers.map((h) => normalizedData[h] ?? '');

  const nextRow = values.length + 1;
  const endCol = colToLetter(headers.length - 1);
  const range = `A${nextRow}:${endCol}${nextRow}`;

  await client
    .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/range(address='${range}')`)
    .patch({ values: [newRow] });

  return data;
};

const updateTableRow = async (tableName, id, data, keyColumn = 'id') => {
  const sheetName = getSheetName(tableName);
  const client = await getGraphClient();

  const res = await client
    .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/usedRange`)
    .get();

  const values = res.values;
  if (!values || values.length < 2) throw new Error('Sheet is empty');

  const headers = normalizeHeaders(values[0]);
  const idIdx = headers.findIndex(h => h.toLowerCase() === keyColumn.toLowerCase());
  if (idIdx === -1) throw new Error(`No "${keyColumn}" column found.`);

  const rowIdx = values.findIndex((row, i) => i > 0 && row[idIdx]?.toString().trim() === id.toString().trim());
  if (rowIdx === -1) throw new Error(`Row with ${keyColumn} ${id} not found`);

  const existingObj = {};
  headers.forEach((h, i) => { existingObj[h] = values[rowIdx][i] ?? ''; });

  const merged = { ...existingObj };
  // Merge data using normalized keys
  Object.keys(data).forEach(k => {
    const normK = k.trim().toLowerCase();
    merged[normK] = data[k];
  });

  const newRow = headers.map((h) => merged[h] ?? '');

  const excelRow = rowIdx + 1;
  const endCol = colToLetter(headers.length - 1);
  const range = `A${excelRow}:${endCol}${excelRow}`;

  await client
    .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/range(address='${range}')`)
    .patch({ values: [newRow] });

  return merged;
};

const deleteTableRow = async (tableName, id, keyColumn = 'id') => {
  const sheetName = getSheetName(tableName);
  const client = await getGraphClient();

  const res = await client
    .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/usedRange`)
    .get();

  const values = res.values;
  if (!values || values.length < 2) throw new Error('Sheet is empty');

  const headers = normalizeHeaders(values[0]);
  const idIdx = headers.findIndex(h => h.toLowerCase() === keyColumn.toLowerCase());
  if (idIdx === -1) throw new Error(`No "${keyColumn}" column found.`);

  const rowIdx = values.findIndex((row, i) => i > 0 && row[idIdx]?.toString().trim() === id.toString().trim());
  if (rowIdx === -1) throw new Error(`Row with ${keyColumn} ${id} not found`);

  const excelRow = rowIdx + 1;

  await client
    .api(`/drives/${DRIVE_ID}/items/${ITEM_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/range(address='${excelRow}:${excelRow}')/delete`)
    .post({ shift: 'Up' });
};

const getNextSno = async (tableName) => {
  try {
    const rows = await getTableRows(tableName);
    if (!rows || rows.length === 0) return 1;
    
    // Find the max value in the 'S.No' column (case-insensitive)
    let maxSno = 0;
    rows.forEach(row => {
      const snoKey = Object.keys(row).find(k => k.toLowerCase() === 's.no');
      if (snoKey) {
        const val = parseInt(row[snoKey]);
        if (!isNaN(val) && val > maxSno) maxSno = val;
      }
    });
    
    return maxSno + 1;
  } catch (error) {
    console.error(`Error calculating next S.No for ${tableName}:`, error.message);
    return 1; // Fallback
  }
};

module.exports = {
  getTableRows,
  addTableRow,
  updateTableRow,
  deleteTableRow,
  getGraphClient,
  getNextSno,
  SHEET_MAP
};
