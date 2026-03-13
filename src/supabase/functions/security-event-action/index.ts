import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    db: { schema: 'wims' }
});

interface SecurityActionPayload {
    log_id: number;
    admin_action_taken: string;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) throw new Error('Missing Authorization header');

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) throw new Error('Invalid token');

        // Check if user is ADMIN or SYSTEM_ADMIN
        const { data: userProfile, error: profileError } = await supabase
            .from('users') // wims.users (default schema set in client?) No, here we need to be specific if needed, but 'users' is likely wims.users if search_path is set or we should specify schema
            .select('role')
            .eq('user_id', user.id)
            .single();

        // Note: Edge Functions usually default to 'public' unless configured. 
        // We should explicitly use the wims schema or ensure the service role client can access it.
        // Better: Use `.schema('wims')` if the library supports it or just assume the query works if search_path is set globally.
        // Let's explicitly try to use schema 'wims' via options in a separate client, or just use the table name if it was `wims.users` but supabase-js handles schemas differently.
        // Actually, for this prototype, if `search_path` is `wims, public`, `from('users')` works. 
        // Let's assume `search_path` includes `wims`. If not, we might need `.schema('wims')`.

        // Let's re-initialize client with schema option to be safe? 
        // Or just query `wims.users`? Supabase-js syntax: .from('users')... 
        // We will stick to simple .from('users') and assume standard config, but if it fails we'll fix.
        // Actually, the previous functions (e.g., upload-bundle) use .from('fire_incidents') which is in wims. 
        // So .from('users') should map to wims.users if that's where they are.

        if (profileError || !userProfile) {
            console.error("Profile check failed:", profileError);
            throw new Error('User profile not found');
        }

        const role = userProfile.role;
        if (role !== 'ADMIN' && role !== 'SYSTEM_ADMIN') {
            throw new Error('Unauthorized: Insufficient privileges');
        }

        const { log_id, admin_action_taken } = await req.json() as SecurityActionPayload;

        if (!log_id || !admin_action_taken) {
            throw new Error('Missing required fields');
        }

        // 1. Update security_threat_logs
        const { error: updateError } = await supabase
            .from('security_threat_logs')
            .update({
                admin_action_taken: admin_action_taken,
                reviewed_by: user.id
            })
            .eq('log_id', log_id);

        if (updateError) throw updateError;

        // 2. Insert into system_audit_trails
        const { error: auditError } = await supabase
            .from('system_audit_trails')
            .insert({
                action_type: 'SECURITY_EVENT_UPDATE',
                table_affected: 'security_threat_logs',
                record_id: log_id.toString(), // cast to string if needed by schema, usually text or int
                user_id: user.id,
                details: JSON.stringify({ action: admin_action_taken }),
                ip_address: req.headers.get('x-forwarded-for') ?? 'unknown'
            });

        if (auditError) console.error("Audit log failed:", auditError);

        return new Response(
            JSON.stringify({ status: 'OK', log_id, admin_action_taken }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
