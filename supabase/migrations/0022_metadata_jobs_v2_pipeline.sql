-- Stage-aware metadata jobs for async semantic enrichment.

alter table public.recipe_metadata_jobs
  add column if not exists stage text not null default 'queued'
    check (stage in ('queued', 'ingredient_resolution', 'ingredient_enrichment', 'recipe_enrichment', 'edge_inference', 'finalize')),
  add column if not exists stage_attempts jsonb not null default '{}'::jsonb,
  add column if not exists rejection_counts jsonb not null default '{}'::jsonb,
  add column if not exists current_run_id uuid references public.enrichment_runs(id) on delete set null,
  add column if not exists last_stage_error text;

create index if not exists recipe_metadata_jobs_stage_poll_idx
  on public.recipe_metadata_jobs(status, stage, next_attempt_at asc);

create index if not exists recipe_metadata_jobs_current_run_idx
  on public.recipe_metadata_jobs(current_run_id);
