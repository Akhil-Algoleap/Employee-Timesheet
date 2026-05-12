const { Client } = require('@microsoft/microsoft-graph-client');
const { PublicClientApplication } = require('@azure/msal-node');
require('isomorphic-fetch');
require('dotenv').config();

const tenantId = process.env.OUTLOOK_TENANT_ID || 'common';
const clientId = process.env.OUTLOOK_CLIENT_ID;
const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
const refreshToken = process.env.OUTLOOK_REFRESH_TOKEN;

// For Delegated auth (Refresh Token flow), we use PublicClientApplication or ConfidentialClientApplication.
// Since we have a refresh token, we can just use ConfidentialClientApplication to redeem it.
const msalConfig = {
    auth: {
        clientId: clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`
    }
};

if (clientSecret) {
    msalConfig.auth.clientSecret = clientSecret;
}

// MSAL Node allows ConfidentialClientApplication to redeem refresh tokens.
// If the app is registered as 'Public', we should not pass the clientSecret.
let pca;
if (clientSecret && clientSecret.trim() !== '') {
    pca = new (require('@azure/msal-node').ConfidentialClientApplication)(msalConfig);
} else {
    pca = new PublicClientApplication(msalConfig);
}

const getGraphClient = () => {
    return Client.init({
        authProvider: async (done) => {
            try {
                if (!refreshToken) {
                    throw new Error("OUTLOOK_REFRESH_TOKEN is missing from .env. Run auth-setup.js first!");
                }

                const tokenRequest = {
                    refreshToken: refreshToken,
                    scopes: ['Mail.Read', 'Mail.Send'],
                };

                // acquireTokenByRefreshToken trades the long-lived refresh token for a short-lived access token
                const response = await pca.acquireTokenByRefreshToken(tokenRequest);

                done(null, response.accessToken);
            } catch (error) {
                console.error("Error acquiring token via Refresh Token:", error);
                done(error, null);
            }
        }
    });
};

module.exports = { getGraphClient };
