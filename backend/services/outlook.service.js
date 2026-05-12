require('dotenv').config();
const { getGraphClient } = require('../config/outlook');

const MAILBOX = process.env.OUTLOOK_MAILBOX || 'operations@algoleap.com';

/**
 * Utility: Sleep (for retry/backoff)
 */
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Strip base URL from nextLink so Graph SDK doesn't double it
 */
function graphGet(client, url) {
    const path = url.startsWith('https://')
        ? '/' + url.split('graph.microsoft.com/v1.0/')[1]
        : url;

    return graphRequestWithRetry(() => client.api(path).get());
}

/**
 * Wrapper with basic retry (handles throttling / transient errors)
 */
async function graphRequestWithRetry(requestFn, retries = 3) {
    let attempt = 0;
    while (attempt < retries) {
        try {
            return await requestFn();
        } catch (err) {
            attempt++;
            const status = err.statusCode || err.code;
            console.warn(`⚠️ Graph API error (attempt ${attempt}):`, status);
            if (attempt >= retries) throw err;
            await sleep(500 * attempt);
        }
    }
}

/**
 * Get ALL child folders under a parent (handles pagination)
 */
async function getAllChildFolders(parentId) {
    const client = getGraphClient();
    let folders = [];
    let url = `/users/${MAILBOX}/mailFolders/${parentId}/childFolders?$select=id,displayName`;

    while (url) {
        const res = await graphGet(client, url);
        folders = folders.concat(res.value || []);
        url = res['@odata.nextLink'] || null;
    }

    return folders;
}

/**
 * Find folder by name (case-insensitive, safe)
 */
async function findFolder(parentId, folderName) {
    const folders = await getAllChildFolders(parentId);

    const folder = folders.find(f =>
        f.displayName.trim().toLowerCase() === folderName.trim().toLowerCase()
    );

    if (!folder) {
        console.log(`❌ Folder not found: ${folderName}`);
        return null;
    }

    console.log(`✅ Found folder: ${folderName}`);
    return folder.id;
}

/**
 * Resolve dynamic folder path:
 * Inbox → CBRE <Year> → <Month>-Timesheets
 */
async function resolveTimesheetFolder(year, month) {
    const yearFolderName = `CBRE ${year}`;
    const monthFolderName = `${month}-Timesheets`;

    console.log(`\n🔍 Resolving: Inbox/${yearFolderName}/${monthFolderName}`);

    // Step 1: Get real Inbox folder ID
    const client = getGraphClient();
    const inbox = await graphRequestWithRetry(() =>
        client.api(`/users/${MAILBOX}/mailFolders/inbox`).select('id,displayName').get()
    );
    const inboxId = inbox.id;
    console.log(`📥 Inbox ID resolved: ${inboxId}`);

    // Step 2: Year folder
    const yearFolderId = await findFolder(inboxId, yearFolderName);
    if (!yearFolderId) return null;

    // Step 3: Month folder
    const monthFolderId = await findFolder(yearFolderId, monthFolderName);
    if (!monthFolderId) return null;

    return monthFolderId;
}

/**
 * Fetch messages from folder (with pagination + filters)
 */
async function getMessagesFromFolder(folderId, lastCheckedTime = null) {
    const client = getGraphClient();
    let messages = [];
    let filterStr = `hasAttachments eq true`;

    if (lastCheckedTime) {
        const isoTime = new Date(lastCheckedTime).toISOString();
        filterStr += ` and receivedDateTime gt ${isoTime}`;
    }

    let url = `/users/${MAILBOX}/mailFolders/${folderId}/messages?$filter=${encodeURIComponent(filterStr)}&$select=id,subject,receivedDateTime,hasAttachments,from&$top=50`;

    while (url) {
        const res = await graphGet(client, url);
        messages = messages.concat(res.value || []);
        url = res['@odata.nextLink'] || null;
    }

    return messages;
}

/**
 * MAIN FUNCTION
 * Checks current + previous month folders
 */
async function getTimesheetEmails(lastCheckedTime = null) {
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        // Apply 10-minute lookback buffer if lastCheckedTime is provided
        let bufferedTime = lastCheckedTime;
        if (lastCheckedTime) {
            const date = new Date(lastCheckedTime);
            date.setMinutes(date.getMinutes() - 10);
            bufferedTime = date.toISOString();
            console.log(`🔍 Fetching emails received after ${bufferedTime} (including 10m buffer)`);
        }

        const monthsToCheck = [
            { y: currentYear, m: currentMonth },
            {
                y: currentMonth === 1 ? currentYear - 1 : currentYear,
                m: currentMonth === 1 ? 12 : currentMonth - 1
            }
        ];

        let allEmails = [];

        for (const target of monthsToCheck) {
            const folderId = await resolveTimesheetFolder(target.y, target.m);
            if (!folderId) continue;

            const emails = await getMessagesFromFolder(folderId, bufferedTime);
            // Attach folder metadata to each email
            const emailsWithMeta = emails.map(e => ({
                ...e,
                folderYear: target.y,
                folderMonth: target.m
            }));
            console.log(`📨 Found ${emailsWithMeta.length} emails for ${target.y}-${target.m}`);
            allEmails = allEmails.concat(emailsWithMeta);
        }

        if (allEmails.length === 0) {
            console.warn("⚠️ No folders resolved or no emails found for either month.");
        }

        return allEmails;

    } catch (error) {
        console.error("❌ Error fetching timesheet emails:", error);
        throw error;
    }
}

/**
 * Get attachments for a message (file attachments only)
 */
async function getAttachments(messageId) {
    const client = getGraphClient();

    try {
        const res = await graphRequestWithRetry(() =>
            client.api(`/users/${MAILBOX}/messages/${messageId}/attachments`).get()
        );

        // Only return file attachments, skip inline images
        return (res.value || []).filter(a =>
            a['@odata.type'] === '#microsoft.graph.fileAttachment'
        );

    } catch (error) {
        console.error(`❌ Error fetching attachments for ${messageId}:`, error);
        throw error;
    }
}

module.exports = {
    getTimesheetEmails,
    getAttachments
};