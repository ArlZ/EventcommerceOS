const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

function getSupabaseClient() {
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required for the Hostinger Supabase connection');
  }

  if (!supabaseKey) {
    throw new Error(
      'A Supabase key is required. Expected SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ANON_KEY, or SUPABASE_KEY',
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function checkSupabaseConnection() {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('organisations').select('id').limit(1);

  if (error) {
    throw new Error(`Supabase connection check failed: ${error.message}`);
  }

  return true;
}

if (require.main === module) {
  checkSupabaseConnection()
    .then(() => {
      console.log('Supabase connection check passed');
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { getSupabaseClient, checkSupabaseConnection };
