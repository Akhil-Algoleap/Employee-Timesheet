const { containerClient } = require('../config/storage');

async function uploadFile(fileBuffer, originalFilename) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');

    // Path: {year}/{month}/{timestamp}_{original_filename}
    const filePath = `${year}/${month}/${Date.now()}_${originalFilename}`;

    try {
        const blockBlobClient = containerClient.getBlockBlobClient(filePath);
        await blockBlobClient.upload(fileBuffer, fileBuffer.length);
        
        console.log(`Successfully uploaded ${originalFilename} to Azure Storage at ${filePath}`);
        return filePath;
    } catch (error) {
        console.error("Error uploading file to Azure storage:", error);
        throw error;
    }
}

module.exports = {
    uploadFile
};
