const db = require('../config/db');

/**
 * Logs a new timesheet attachment for background processing.
 */
async function logPendingTimesheet(emailId, filename, storagePath, receivedAt, targetMonth, targetYear) {
    try {
        const query = `
            INSERT INTO timesheet_logs (outlook_message_id, extracted_timesheet_filename, storage_path, status, received_at, target_month, target_year)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
        `;
        const values = [emailId, filename, storagePath, 'pending', receivedAt, targetMonth, targetYear];
        const res = await db.query(query, values);
        return res.rows[0];
    } catch (error) {
        console.error("Error logging pending timesheet to Azure:", error);
        throw error;
    }
}

/**
 * Checks if a specific attachment from an email has already been logged.
 */
async function isAttachmentProcessed(emailId, filename) {
    try {
        const query = `
            SELECT id FROM timesheet_logs
            WHERE outlook_message_id = $1 
            AND extracted_timesheet_filename = $2
            LIMIT 1;
        `;
        const values = [emailId, filename];
        const res = await db.query(query, values);
        return res.rows.length > 0;
    } catch (error) {
        console.error("Error checking if attachment is logged in Azure:", error);
        // Re-throw so the caller skips this attachment on uncertainty,
        // rather than re-ingesting it (which causes duplicates).
        throw error;
    }
}

async function getLatestReceivedTime() {
    try {
        const query = 'SELECT MAX(received_at) as last_time FROM timesheet_logs';
        const res = await db.query(query);
        return res.rows[0].last_time;
    } catch (error) {
        console.error("Error fetching latest received time:", error);
        return null;
    }
}

module.exports = {
    logPendingTimesheet,
    isAttachmentProcessed,
    getLatestReceivedTime
};
