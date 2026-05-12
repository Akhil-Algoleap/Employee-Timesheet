const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getGraphClient } = require('../config/outlook');

const MAILBOX = process.env.OUTLOOK_MAILBOX || 'operations@algoleap.com';

async function debugOutlook() {
    const client = getGraphClient();

    // ─── STEP 1: Check if mailbox is reachable ───
    console.log('\n📬 STEP 1: Checking mailbox access...');
    try {
        const user = await client
            .api(`/users/${MAILBOX}`)
            .select('displayName,mail')
            .get();
        console.log('✅ Mailbox accessible:', user.displayName, user.mail);
    } catch (err) {
        console.error('❌ Cannot access mailbox:', err.message);
        return; // No point continuing
    }

    // ─── STEP 2: Get Inbox ID ───
    console.log('\n📥 STEP 2: Fetching Inbox folder ID...');
    let inboxId;
    try {
        const inbox = await client
            .api(`/users/${MAILBOX}/mailFolders/inbox`)
            .select('id,displayName')
            .get();
        inboxId = inbox.id;
        console.log('✅ Inbox ID:', inboxId);
    } catch (err) {
        console.error('❌ Cannot fetch Inbox:', err.message);
        return;
    }

    // ─── STEP 3: List all direct children of Inbox ───
    console.log('\n📂 STEP 3: Listing Inbox child folders...');
    try {
        const res = await client
            .api(`/users/${MAILBOX}/mailFolders/${inboxId}/childFolders`)
            .select('id,displayName')
            .get();

        console.log(`✅ Found ${res.value.length} folders:`);
        res.value.forEach(f => console.log(`   - "${f.displayName}" (id: ${f.id})`));
    } catch (err) {
        console.error('❌ Cannot list child folders:', err.message);
        return;
    }

    // ─── STEP 4: Try to find CBRE 2026 ───
    console.log('\n🔍 STEP 4: Looking for CBRE 2026...');
    try {
        const res = await client
            .api(`/users/${MAILBOX}/mailFolders/${inboxId}/childFolders`)
            .select('id,displayName')
            .get();

        const cbreFolder = res.value.find(f =>
            f.displayName.trim().toLowerCase() === 'cbre 2026'
        );

        if (!cbreFolder) {
            console.error('❌ CBRE 2026 not found. Available folders:', res.value.map(f => f.displayName));
            return;
        }

        console.log('✅ CBRE 2026 found! ID:', cbreFolder.id);

        // ─── STEP 5: List children of CBRE 2026 ───
        console.log('\n📂 STEP 5: Listing CBRE 2026 child folders...');
        const monthRes = await client
            .api(`/users/${MAILBOX}/mailFolders/${cbreFolder.id}/childFolders`)
            .select('id,displayName')
            .get();

        console.log(`✅ Found ${monthRes.value.length} month folders:`);
        monthRes.value.forEach(f => console.log(`   - "${f.displayName}" (id: ${f.id})`));

        // ─── STEP 6: Check message count in 4-Timesheets ───
        const aprilFolder = monthRes.value.find(f =>
            f.displayName.trim().toLowerCase() === '4-timesheets'
        );

        if (aprilFolder) {
            console.log('\n📨 STEP 6: Fetching messages from 4-Timesheets...');
            const msgRes = await client
                .api(`/users/${MAILBOX}/mailFolders/${aprilFolder.id}/messages`)
                .filter('hasAttachments eq true')
                .select('id,subject,receivedDateTime,from')
                .top(5)
                .get();

            console.log(`✅ Found ${msgRes.value.length} messages (showing up to 5):`);
            msgRes.value.forEach(m =>
                console.log(`   - "${m.subject}" from ${m.from?.emailAddress?.address} on ${m.receivedDateTime}`)
            );
        }

    } catch (err) {
        console.error('❌ Error in CBRE folder lookup:', err.message, err.statusCode);
    }
}

async function runTests() {
    // ─── STEP 7: Test the actual getTimesheetEmails function ───
    const { getTimesheetEmails, getAttachments } = require('./outlook.service');

    console.log('\n🚀 STEP 7: Testing getTimesheetEmails...');
    try {
        const emails = await getTimesheetEmails();

        console.log(`\n✅ Total emails fetched: ${emails.length}`);

        if (emails.length === 0) {
            console.warn('⚠️ No emails returned — check folder names or filters');
        } else {
            // ─── STEP 8: Print each email ───
            console.log('\n📋 STEP 8: Email details:');
            emails.forEach((mail, i) => {
                console.log(`\n  [${i + 1}] Subject    : ${mail.subject}`);
                console.log(`       From       : ${mail.from?.emailAddress?.address}`);
                console.log(`       Received   : ${mail.receivedDateTime}`);
                console.log(`       Has Attach : ${mail.hasAttachments}`);
            });

            // ─── STEP 9: Test getAttachments on first email ───
            console.log('\n📎 STEP 9: Fetching attachments for first email...');
            const attachments = await getAttachments(emails[0].id);

            if (attachments.length === 0) {
                console.warn('⚠️ No file attachments found on first email');
            } else {
                console.log(`✅ Found ${attachments.length} attachment(s):`);
                attachments.forEach(a => {
                    console.log(`   - Name : ${a.name}`);
                    console.log(`     Size : ${(a.size / 1024).toFixed(1)} KB`);
                    console.log(`     Type : ${a.contentType}`);
                });
            }
        }
    } catch (err) {
        console.error('❌ getTimesheetEmails failed:', err.message);
        console.error('   Status:', err.statusCode);
        console.error('   Stack :', err.stack);
    }
}

async function main() {
    await debugOutlook();
    await runTests();
}

main().catch(console.error);