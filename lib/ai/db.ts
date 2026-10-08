import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Database access for AI work.
 *  - Started from the Admin panel: the signed-in staff member's own session
 *    (RLS: staff-only AI tables, product writes allowed for staff).
 *  - Background work with no signed-in user (stock webhook): the service role,
 *    when SUPABASE_SERVICE_ROLE_KEY is configured.
 * No service-role key is needed for adding models or running AI from Admin.
 */
export async function aiDb(): Promise<SupabaseClient> {
  return getServiceClient() ?? ((await createClient()) as unknown as SupabaseClient);
}
