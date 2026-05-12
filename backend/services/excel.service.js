const xlsx = require('xlsx');

function parseExcelBuffer(buffer) {
    try {
        // Read the buffer using xlsx
        const workbook = xlsx.read(buffer, { type: 'buffer' });

        // As per requirement: Read the first worksheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convert rows to Array of Arrays (to handle complex headers like CBRE)
        const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null });

        return jsonData;
    } catch (error) {
        console.error("Error parsing Excel file:", error);
        throw error;
    }
}

module.exports = {
    parseExcelBuffer
};
