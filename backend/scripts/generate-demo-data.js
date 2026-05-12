const xlsx = require('xlsx');
const fs = require('fs');

const filePath = 'd:/Laptop/employee-timestamp-system/CBRE Timesheet format_PL-HYD_2026.xlsx';

function generateDemoData() {
    console.log(`Reading workbook: ${filePath}`);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Inject Demo Employee at Row 12 (index 11)
    const demoRows = [
        [
            "John Doe",          // A: Employee Name
            "CBRE001",           // B: Employee ID
            45292,               // C: Joining Date (Excel serial for Jan 1, 2024 approx)
            "Manager Smith",      // D: Reporting Manager
            "Leader Jones",      // E: D&T Leader
            "8", "8", "WE", "WE", "8", "8", "8", "8", "8", "WE", "WE", "8", "8", "8", "8", "8", "WE", "WE", "8", "8", "8", "8", "8", "WE", "WE", "8", "8", "8", "8", "8", "WE"
        ]
    ];

    // Write starting from Row 12 (A12)
    xlsx.utils.sheet_add_aoa(worksheet, demoRows, { origin: "A11" }); // Index starts from A1 (A11 is Row 11, A12 is Row 12)
    // Wait, Excel Rows are 1-based. Row 11 is A11. Row 12 is A12.
    // My mapping service does: const dataRows = rows.slice(headerRowIndex + 2);
    // If headerRowIndex is 9 (Row 10), then dataRows start at index 11 (Row 12).
    // So I should write to A12.
    
    xlsx.utils.sheet_add_aoa(worksheet, demoRows, { origin: "A12" });

    // Write back
    xlsx.writeFile(workbook, filePath);
    console.log("✅ Demo data injected successfully to Row 12!");
}

generateDemoData();
