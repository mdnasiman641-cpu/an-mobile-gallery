-- =====================================================================
-- 0011 · AI without the service-role key
--
-- AI requests started from the Admin panel now run with the signed-in staff
-- member's own Supabase session (RLS applies) instead of the service role.
--
--   * Staff may read AI model configs, including api_key_ciphertext. That
--     column only holds AES-256-GCM ciphertext; the key that decrypts it
--     lives in the Cloudflare Worker's private R2 bucket and never reaches
--     the database or the browser.
--   * Changing models / routing stays admin-only.
--   * Staff may record AI jobs, attempts and model health.
-- Visitors (anon) and customers still have no access to any AI table.
-- =====================================================================

grant select (api_key_ciphertext) on public.ai_models to authenticated;

create policy "ai_models: staff read" on public.ai_models for select to authenticated
  using ((select public.is_staff()));
create policy "ai_settings: staff read" on public.ai_settings for select to authenticated
  using ((select public.is_staff()));

create policy "ai_model_health: staff read" on public.ai_model_health for select to authenticated
  using ((select public.is_staff()));
create policy "ai_model_health: staff insert" on public.ai_model_health for insert to authenticated
  with check ((select public.is_staff()));
create policy "ai_model_health: staff update" on public.ai_model_health for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "ai_jobs: staff insert" on public.ai_jobs for insert to authenticated
  with check ((select public.is_staff()));
create policy "ai_jobs: staff update" on public.ai_jobs for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "ai_job_attempts: staff insert" on public.ai_job_attempts for insert to authenticated
  with check ((select public.is_staff()));
