const cron = require('node-cron');
const db = require('../config/db');
const { parseTimesheet } = require('../services/parser.service');
const onedrive = require('../services/onedrive.service');

async function syncJobToOneDrive(jobId) {
    try {
        const jobRes = await db.query('SELECT * FROM timesheet_logs WHERE id = $1', [jobId]);
        if (jobRes.rows.length === 0) return;
        const job = jobRes.rows[0];

        const logToSave = {
            "ID": job.id,
            "File Name": job.extracted_timesheet_filename,
            "Status": job.status,
            "Created At": job.created_at ? (job.created_at instanceof Date ? job.created_at.toISOString() : job.created_at) : new Date().toISOString()
        };

        const logs = await onedrive.getTableRows('LogsTable');
        const existing = logs.find(l => String(l.ID) === String(job.id));
        if (existing) {
            await onedrive.updateTableRow('LogsTable', job.id, logToSave, 'ID');
        } else {
            await onedrive.addTableRow('LogsTable', logToSave);
        }
    } catch (err) {
        console.error("OneDrive Log Sync Error:", err.message);
    }
}

// Concurrency Lock: Prevents multiple processor runs from overlapping
let isProcessing = false;

/**
 * Resets jobs stuck in 'processing' for too long (e.g., > 10 mins) back to 'pending'.
 */
async function cleanupStuckJobs() {
    try {
        const query = `
            UPDATE timesheet_logs 
            SET status = 'pending' 
            WHERE status = 'processing' 
            AND created_at < NOW() - INTERVAL '10 minutes';
        `;
        await db.query(query);
    } catch (error) {
        console.error("Processor Worker: Error cleaning up stuck jobs in Azure:", error);
    }
}

/**
 * Polls for 'pending' timesheets and processes them one by one.
 */
async function processPendingLogs(verbose = false) {
    if (isProcessing) {
        if (verbose) console.log("Processor Worker: Already running. Skipping this trigger.");
        return;
    }

    isProcessing = true;
    if (verbose) console.log(`[${new Date().toLocaleString()}] Processor Worker: Starting check...`);
    
    try {
        // First, recover any jobs that died mid-process
        await cleanupStuckJobs();

        let jobsProcessed = 0;
        while (true) {
            // Atomic Claim: Select the oldest pending job and mark it as 'processing' in one go
            const claimQuery = `
                UPDATE timesheet_logs
                SET status = 'processing'
                WHERE id = (
                    SELECT id FROM timesheet_logs
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                RETURNING *;
            `;
            
            const res = await db.query(claimQuery);

            if (res.rows.length === 0) {
                if (verbose && jobsProcessed > 0) console.log(`Processor Worker: All ${jobsProcessed} pending jobs completed.`);
                else if (verbose) console.log("Processor Worker: No pending jobs found.");
                break;
            }

            const job = res.rows[0];
            jobsProcessed++;
            console.log(`Processor Worker: Starting job ID ${job.id} [${jobsProcessed}] for file ${job.extracted_timesheet_filename}`);
            await syncJobToOneDrive(job.id);

            try {
                // CALL THE PARSER
                await parseTimesheet(job);

                // Update status to completed
                await db.query("UPDATE timesheet_logs SET status = 'completed' WHERE id = $1", [job.id]);
                await syncJobToOneDrive(job.id);
                console.log(`Processor Worker: Successfully completed job ID ${job.id}`);
            } catch (err) {
                console.error(`Processor Worker: Job ID ${job.id} failed:`, err.message || err);
                
                try {
                    // Log error to file
                    const fs = require('fs');
                    const errorMsg = err.stack || err.message || String(err);
                    fs.appendFileSync('processor-error.log', `[${new Date().toLocaleString()}] Job ${job.id} failed: ${errorMsg}\n\n`);

                    // Update status to failed
                    await db.query("UPDATE timesheet_logs SET status = 'failed', error_message = $2 WHERE id = $1", [job.id, err.message]);
                    await syncJobToOneDrive(job.id);
                } catch (innerErr) {
                    console.error(`Processor Worker: Could not even mark job ${job.id} as failed:`, innerErr.message);
                }
            }
        }
    } catch (criticalError) {
        console.error("Processor Worker: CRITICAL failure in execution loop:", criticalError);
    } finally {
        isProcessing = false;
    }
}

function startProcessor() {
    // Run every 30 seconds
    cron.schedule('*/30 * * * * *', () => {
        processPendingLogs(false);
    });
    console.log("Processor worker scheduled to run every 30 seconds.");
}

module.exports = {
    startProcessor,
    processPendingLogs
};
