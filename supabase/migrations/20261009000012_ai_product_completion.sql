-- =====================================================================
-- 0012 · "Complete with AI" in the product form
--
--   * ai_jobs.task_type gains 'complete': one Complete with AI run. The
--     existing one-active-job-per-product index also stops two runs for the
--     same product at once. These jobs are never processed by the AI queue.
--   * ai_product_content.form_completion caches the last result, so
--     reloading the product page shows it again without a new AI request.
--     It is only a suggestion: nothing in it is written to the product until
--     the admin applies it in the form and saves.
-- RLS is unchanged: both tables stay staff-only (anon and customers have no
-- access), as set up in 0010 and 0011.
-- =====================================================================

alter table public.ai_jobs drop constraint if exists ai_jobs_task_type_check;
alter table public.ai_jobs add constraint ai_jobs_task_type_check
  check (task_type in ('full', 'verify', 'seo', 'description', 'faq', 'improve', 'test', 'complete'));

alter table public.ai_product_content add column if not exists form_completion jsonb;
alter table public.ai_product_content drop constraint if exists ai_product_content_form_completion_object;
alter table public.ai_product_content add constraint ai_product_content_form_completion_object
  check (form_completion is null or jsonb_typeof(form_completion) = 'object');
