const xlsx = require('xlsx');
const path = require('path');

const filePath = 'd:/Laptop/employee-timestamp-system/CBRE Timesheet format_PL-HYD_2026.xlsx';

function inspect() {
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });

    data.forEach((row, i) => {
        if (row && row.some(cell => cell !== null && cell !== '')) {
            console.log(`Row ${i}: ${JSON.stringify(row.slice(0, 5))}`);
            if (row[0] && String(row[0]).includes('Employee Name')) {
                console.log(`>>> FOUND HEADER AT INDEX ${i}`);
            }
        }
    });
}
inspect();
