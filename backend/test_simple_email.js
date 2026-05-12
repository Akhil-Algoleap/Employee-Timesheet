const { getGraphClient } = require('./config/outlook');
require('dotenv').config();

async function testSimpleEmail() {
    const client = getGraphClient();
    const recipient = process.env.SEND_TO_EMAIL;
    const subject = "TEST: Simple Email Delivery Verification";

    const emailData = {
        message: {
            subject: subject,
            body: {
                contentType: 'Text',
                content: "This is a simple test email to verify delivery. No attachments."
            },
            toRecipients: [
                {
                    emailAddress: {
                        address: recipient
                    }
                }
            ]
        },
        saveToSentItems: true
    };

    try {
        console.log(`Sending simple test email to ${recipient}...`);
        await client.api('/me/sendMail').post(emailData);
        console.log("Test email successfully accepted by MS Graph.");
    } catch (error) {
        console.error("Test email failed:", error);
    }
}

testSimpleEmail();
