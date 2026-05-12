const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './backend/.env' });
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data: att } = await supabase.from('attendance').select('*').limit(20);
    console.log("Sample Attendance:");
    att.forEach(a => console.log(`${a.date} | ${a.day} | ${a.working_hours}`));
}
check();
