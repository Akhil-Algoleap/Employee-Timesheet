require('dotenv').config();
const { PublicClientApplication, LogLevel } = require('@azure/msal-node');
const fs = require('fs');

const tenantId = process.env.OUTLOOK_TENANT_ID || 'common'; // 'common' allows personal accounts
const clientId = process.env.OUTLOOK_CLIENT_ID;

if (!clientId) {
    console.error("Missing OUTLOOK_CLIENT_ID in .env");
    process.exit(1);
}

const msalConfig = {
    auth: {
        clientId: clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message, containsPii) {
                // console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: LogLevel.Warning,
        }
    }
};

const pca = new PublicClientApplication(msalConfig);

async function acquireToken() {
    const deviceCodeRequest = {
        deviceCodeCallback: (response) => {
            console.log("\n===============================================");
            if (response.message) {
                console.log(response.message);
            } else {
                console.log("Device code response received (message missing):", JSON.stringify(response, null, 2));
            }
            console.log("===============================================\n");
        },
        scopes: ['Mail.Read', 'Mail.Send', 'offline_access'],
    };

    try {
        const response = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
        console.log("Successfully logged in!");

        // Extract the refresh token from the cache
        const tokenCache = pca.getTokenCache().serialize();
        const cacheObj = JSON.parse(tokenCache);

        let refreshToken = null;
        if (cacheObj.RefreshToken) {
            const keys = Object.keys(cacheObj.RefreshToken);
            if (keys.length > 0) {
                refreshToken = cacheObj.RefreshToken[keys[0]].secret;
            }
        }

        if (refreshToken) {
            console.log("\n===============================================");
            console.log("🎉 SUCCESS! Add the following to your .env file:");
            console.log("===============================================\n");
            console.log(`OUTLOOK_REFRESH_TOKEN=${refreshToken}`);
            console.log("\n===============================================\n");
        } else {
            console.error("Could not extract Refresh Token. Make sure 'offline_access' was granted.");
        }

    } catch (error) {
        console.error("Error acquiring token:", error);
    }
}

acquireToken();
