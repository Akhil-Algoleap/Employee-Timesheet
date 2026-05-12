const express = require('express');
const cors = require('cors');
const { startWorker } = require('./workers/email.worker');
const { startProcessor } = require('./workers/processor.worker');
const apiService = require('./services/api.service');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001; // Backend server port

app.use(cors());
app.use(express.json());

// Health Endpoint
app.get('/health', (req, res) => {
    res.status(200).send("automation running");
});

app.get('/api/po-data', async (req, res) => {
    try {
        const { year, month } = req.query;
        const yearInt = parseInt(year);
        const monthInt = parseInt(month);

        if (isNaN(yearInt) || isNaN(monthInt)) {
            console.warn(`Invalid PO data request: year=${year}, month=${month}`);
            return res.status(400).json({ error: "Invalid year or month format" });
        }

        const data = await apiService.getAttendanceData(yearInt, monthInt);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API Endpoint for Logs
app.get('/api/logs', async (req, res) => {
    try {
        const data = await apiService.getTimesheetLogs();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/employees', async (req, res) => {
    try {
        const data = await apiService.getAllEmployees();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/po-data/save', async (req, res) => {
    try {
        const employeeData = req.body;
        if (!employeeData || !employeeData.employee_id) {
            return res.status(400).json({ error: "Invalid employee data" });
        }
        await apiService.saveEmployeeData(employeeData);
        res.json({ message: "Saved successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/po-sheet', async (req, res) => {
    try {
        const { year, month } = req.query;
        const yearInt = parseInt(year);
        const monthInt = parseInt(month);
        if (isNaN(yearInt) || isNaN(monthInt)) return res.status(400).json({ error: 'Invalid year or month' });
        const data = await apiService.getPOSheetData(yearInt, monthInt);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/po-data/:employee_id', async (req, res) => {
    try {
        const { employee_id } = req.params;
        if (!employee_id) return res.status(400).json({ error: 'Missing employee_id' });
        await apiService.deleteEmployee(employee_id);
        res.json({ message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/po-sheet/save', async (req, res) => {
    try {
        const rowData = req.body;
        if (!rowData || !rowData.employee_id) return res.status(400).json({ error: 'Missing employee_id' });
        await apiService.savePOSheetRow(rowData);
        res.json({ message: 'Saved successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/timesheet-status', async (req, res) => {
    try {
        const { year, month } = req.query;
        const yearInt = parseInt(year);
        const monthInt = parseInt(month);
        if (isNaN(yearInt) || isNaN(monthInt)) return res.status(400).json({ error: 'Invalid year or month' });
        const data = await apiService.getTimesheetStatus(yearInt, monthInt);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



app.get('/api/download-timesheet', async (req, res) => {
    try {
        const { employee_id, year, month } = req.query;
        if (!employee_id || !year || !month) {
            return res.status(400).json({ error: 'Missing employee_id, year, or month' });
        }

        const yearInt = parseInt(year);
        const monthInt = parseInt(month);
        if (isNaN(yearInt) || isNaN(monthInt)) {
            return res.status(400).json({ error: 'Invalid year or month' });
        }

        const { generateEmployeeTimesheetExcel } = require('./services/export.service');
        const workbook = await generateEmployeeTimesheetExcel(employee_id, yearInt, monthInt);

        // Build filename: Timesheet_<Name>_<Mon'YY>_Algoleap_CBRE-HYD.xlsx
        const db = require('./config/db');
        const empRes = await db.query('SELECT employee_name FROM employees WHERE employee_id = $1', [employee_id]);
        const emp = empRes.rows[0];

        const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthLabel = `${shortMonths[monthInt - 1]}'${String(yearInt).slice(2)}`;
        const empName = emp ? emp.employee_name : employee_id;
        const filename = `Timesheet_${empName}_${monthLabel}_Algoleap_CBRE-HYD.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        const buffer = await workbook.xlsx.writeBuffer();
        res.send(buffer);
    } catch (error) {
        console.error('Error generating employee timesheet download:', error);
        res.status(500).json({ error: error.message });
    }
});

// /api/convert-data endpoint removed — it was a destructive, unauthenticated
// endpoint that permanently altered production attendance data (rewrote 2024→2026
// dates then deleted the originals). It also relied on Supabase which is no longer active.

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);

    // Start ingestion and processing workers
    startWorker();
    startProcessor();
});
