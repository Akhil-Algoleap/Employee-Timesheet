const cron = require('node-cron');
const { getTimesheetEmails, getAttachments } = require('../services/outlook.service');
const { uploadFile } = require('../services/storage.service');
const { logPendingTimesheet, isAttachmentProcessed, getLatestReceivedTime } = require('../services/db.service');
// Import processor for immediate follow-up
const { processPendingLogs } = require('./processor.worker');

async function processTimesheetEmails() {
    console.log(`[${new Date().toLocaleString()}] Starting timesheet email ingestion...`);
    try {
        const lastTime = await getLatestReceivedTime();
        const emails = await getTimesheetEmails(lastTime);
        console.log(`Emails detected: ${emails.length}`);

        for (const email of emails) {
            console.log(`Checking email: ${email.subject} (ID: ${email.id})`);
            const attachments = await getAttachments(email.id);

            // Filter for Excel files
            const excelAttachments = attachments.filter(att =>
                att.name && (att.name.endsWith('.xlsx') || att.name.endsWith('.xls'))
            );

            if (excelAttachments.length === 0) {
                console.log(`No Excel attachments found in email ${email.id}.`);
                continue;
            }

            console.log(`Email ID ${email.id} has ${excelAttachments.length} Excel attachments.`);
            let filesLogged = 0;
            for (const attachment of excelAttachments) {
                // Check if THIS SPECIFIC ATTACHMENT is already processed
                const exists = await isAttachmentProcessed(email.id, attachment.name);
                if (exists) {
                    console.log(`Skipping attachment ${attachment.name}: Already logged.`);
                    continue;
                }

                if (!attachment.contentBytes) continue;

                const fileBuffer = Buffer.from(attachment.contentBytes, 'base64');

                // 1. Upload to Supabase Storage
                const storagePath = await uploadFile(fileBuffer, attachment.name);
                
                // 2. Log into timesheet_logs as 'pending'
                await logPendingTimesheet(
                    email.id, 
                    attachment.name, 
                    storagePath, 
                    email.receivedDateTime,
                    email.folderMonth,
                    email.folderYear
                );
                filesLogged++;
                console.log(`[${filesLogged}/${excelAttachments.length}] File logged: ${attachment.name}`);
            }
            if (filesLogged > 0) {
                console.log(`Ingestion: Logged ${filesLogged} new files for email ${email.id}`);
            }
        }
    } catch (error) {
        console.error("Error in processTimesheetEmails (Ingestion):", error);
    }
    console.log(`[${new Date().toLocaleString()}] Finished timesheet email ingestion.`);
    
    // Trigger the processor immediately after ingestion with verbose logs
    await processPendingLogs(true);
}

function startWorker() {
    // Run ingestion every 2 minutes
    cron.schedule('*/2 * * * *', () => {
        processTimesheetEmails();
    });
    console.log("Email ingestion worker scheduled to run every 2 minutes.");
}

module.exports = {
    startWorker,
    processTimesheetEmails
};
