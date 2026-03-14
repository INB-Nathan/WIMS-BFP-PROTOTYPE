// get-tokens.mjs
import { createClient } from '@supabase/supabase-js';

// 1. Fill these from Supabase Settings -> API
const SUPABASE_URL = 'https://hfbuqamwwvvpoudouvyw.supabase.co';          // e.g. https://hfbuqamwwvvpoudouvyw.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYnVxYW13d3Z2cG91ZG91dnl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNDYxNjksImV4cCI6MjA4NjcyMjE2OX0.EdVeL4h1D1MRUdd-7z59RwDepruchRcbTLBxoVe_tck'; // "anon public" key

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Helper to sign in a user and print their access token
 */
async function getToken(label, email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        console.error(`Error for ${label} (${email}):`, error.message);
        return;
    }

    const token = data.session?.access_token;
    if (!token) {
        console.error(`No session/token returned for ${label} (${email})`);
        return;
    }

    console.log('==============================');
    console.log(`Role: ${label}`);
    console.log(`Email: ${email}`);
    console.log('Access token:\n');
    console.log(token);
    console.log('\n');
}

/**
 * Run for all four roles
 * Make sure these passwords match exactly what you set in Supabase Auth.
 */
(async () => {
    await getToken('ENCODER', 'encoder_ncr@bfp.gov.ph', 'Encoder123!');
    await getToken('VALIDATOR', 'validator_ncr@bfp.gov.ph', 'Validator123!');
    await getToken('ANALYST', 'analyst_nhq@bfp.gov.ph', 'Analyst123!');
    await getToken('ADMIN', 'admin_nhq@bfp.gov.ph', 'Admin123!');
})();
