require('dotenv').config();
const supabase = require('./config/supabase');

async function resetDatabase() {
    console.log("⚠️  Starting Database Cleanup...");

    const tables = ['attendance', 'employees', 'timesheet_logs'];

    for (const table of tables) {
        process.stdout.write(`Cleaning ${table}... `);
        try {
            // We use a raw RPG-like call if possible, but Supabase SDK doesn't have truncate.
            // So we delete all rows instead.
            const { error } = await supabase
                .from(table)
                .delete()
                .neq('id', -1); // Deletes everything where id is not -1

            if (error) {
                console.log("❌ Failed (Make sure table exists)");
            } else {
                console.log("✅ Done");
            }
        } catch (e) {
            console.log("❌ Error");
        }
    }

    console.log("\n✨ Database is now clean and ready for Phase 2!");
    process.exit(0);
}

resetDatabase();
