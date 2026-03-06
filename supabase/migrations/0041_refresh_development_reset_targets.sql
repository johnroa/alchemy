-- Refresh development reset targets to cover the current food schema and
-- keep preview + wipe target selection in one place.

create or replace function public.admin_dev_food_reset_targets(preset text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized text := lower(trim(coalesce(preset, '')));
begin
  case normalized
    when 'recipes_domain_reset' then
      return array[
        'recipe_draft_messages',
        'recipe_drafts',
        'candidate_image_bindings',
        'image_jobs',
        'recipe_image_assignments',
        'image_requests',
        'recipe_search_sessions',
        'recipe_search_documents',
        'explore_publications',
        'recipe_graph_links',
        'graph_edge_evidence',
        'graph_edges',
        'graph_entities',
        'ingredient_pair_stats',
        'recipe_pair_stats',
        'memory_recipe_links',
        'recipe_version_events',
        'recipe_links',
        'recipe_image_jobs',
        'recipe_image_assets',
        'recipe_auto_categories',
        'recipe_user_categories',
        'collection_items',
        'recipe_saves',
        'enrichment_runs',
        'recipe_metadata_jobs',
        'recipe_ingredient_ontology_links',
        'recipe_ingredient_mentions',
        'recipe_ingredients',
        'recipe_versions',
        'recipes'
      ];
    when 'ingredients_ontology_reset' then
      return array[
        'ingredients',
        'ingredient_aliases',
        'recipe_ingredients',
        'recipe_ingredient_mentions',
        'recipe_ingredient_ontology_links',
        'ingredient_ontology_links',
        'ontology_terms',
        'ingredient_pair_stats',
        'recipe_pair_stats',
        'recipe_graph_links',
        'graph_edge_evidence',
        'graph_edges',
        'graph_entities'
      ];
    when 'graph_reset' then
      return array[
        'recipe_graph_links',
        'graph_edge_evidence',
        'graph_edges',
        'graph_entities',
        'ingredient_pair_stats',
        'recipe_pair_stats'
      ];
    when 'full_food_reset' then
      return array[
        'recipe_draft_messages',
        'recipe_drafts',
        'candidate_image_bindings',
        'image_jobs',
        'recipe_image_assignments',
        'image_requests',
        'recipe_search_sessions',
        'recipe_search_documents',
        'explore_publications',
        'recipe_graph_links',
        'graph_edge_evidence',
        'graph_edges',
        'graph_entities',
        'memory_recipe_links',
        'recipe_version_events',
        'recipe_links',
        'recipe_image_jobs',
        'recipe_image_assets',
        'recipe_auto_categories',
        'recipe_user_categories',
        'collection_items',
        'recipe_saves',
        'enrichment_runs',
        'recipe_metadata_jobs',
        'recipe_ingredient_ontology_links',
        'recipe_ingredient_mentions',
        'recipe_ingredients',
        'ingredient_pair_stats',
        'recipe_pair_stats',
        'ingredient_ontology_links',
        'ingredient_aliases',
        'ingredients',
        'ontology_terms',
        'recipe_versions',
        'recipes'
      ];
    else
      raise exception using
        errcode = '22023',
        message = 'invalid preset',
        detail = 'Supported presets: recipes_domain_reset, ingredients_ontology_reset, graph_reset, full_food_reset';
  end case;
end;
$$;

create or replace function public.admin_dev_food_data_preview(preset text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := lower(trim(coalesce(preset, '')));
  targets text[] := public.admin_dev_food_reset_targets(normalized);
  counts jsonb := '{}'::jsonb;
  tbl text;
  cnt bigint;
  total bigint := 0;
begin
  foreach tbl in array targets loop
    if to_regclass(format('%I.%I', 'public', tbl)) is null then
      cnt := 0;
    else
      execute format('select count(*)::bigint from %I.%I', 'public', tbl) into cnt;
    end if;
    counts := counts || jsonb_build_object(tbl, cnt);
    total := total + coalesce(cnt, 0);
  end loop;

  return jsonb_build_object(
    'preset', normalized,
    'table_counts', counts,
    'total_rows', total
  );
end;
$$;

create or replace function public.admin_dev_food_data_wipe(
  preset text,
  confirm_text text,
  reason text default null,
  actor_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := lower(trim(coalesce(preset, '')));
  expected_confirm text;
  preview jsonb;
  post jsonb;
  run_id uuid;
  targets text[] := public.admin_dev_food_reset_targets(normalized);
  truncate_targets text;
begin
  expected_confirm := format('WIPE %s', upper(replace(normalized, '_', ' ')));

  if trim(coalesce(confirm_text, '')) <> expected_confirm then
    raise exception using
      errcode = '22023',
      message = 'confirmation text mismatch',
      detail = format('Expected exact confirmation text: %s', expected_confirm);
  end if;

  preview := public.admin_dev_food_data_preview(normalized);

  insert into public.development_operation_runs(
    operation_key,
    status,
    requested_by_email,
    request_payload,
    preview_counts,
    result_counts,
    created_at,
    updated_at
  )
  values (
    normalized,
    'processing',
    actor_email,
    jsonb_build_object(
      'confirm_text', confirm_text,
      'reason', coalesce(reason, ''),
      'actor_email', coalesce(actor_email, '')
    ),
    coalesce(preview -> 'table_counts', '{}'::jsonb),
    '{}'::jsonb,
    now(),
    now()
  )
  returning id into run_id;

  select string_agg(format('%I.%I', 'public', tbl), ', ' order by ord)
    into truncate_targets
  from unnest(targets) with ordinality as target(tbl, ord)
  where to_regclass(format('%I.%I', 'public', tbl)) is not null;

  if truncate_targets is not null then
    execute format('truncate table %s restart identity cascade', truncate_targets);
  end if;

  post := public.admin_dev_food_data_preview(normalized);

  update public.development_operation_runs
  set status = 'succeeded',
      result_counts = coalesce(post -> 'table_counts', '{}'::jsonb),
      updated_at = now(),
      completed_at = now()
  where id = run_id;

  perform public.log_changelog_event(
    null,
    'development',
    'development_operation',
    run_id::text,
    'wipe_executed',
    null,
    preview,
    post,
    jsonb_build_object(
      'operation_key', normalized,
      'reason', coalesce(reason, ''),
      'requested_by_email', coalesce(actor_email, '')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'run_id', run_id,
    'preset', normalized,
    'expected_confirm', expected_confirm,
    'before', preview,
    'after', post
  );
exception
  when others then
    if run_id is not null then
      update public.development_operation_runs
      set status = 'failed',
          error = sqlerrm,
          updated_at = now(),
          completed_at = now()
      where id = run_id;

      perform public.log_changelog_event(
        null,
        'development',
        'development_operation',
        run_id::text,
        'wipe_failed',
        null,
        preview,
        jsonb_build_object('error', sqlerrm),
        jsonb_build_object(
          'operation_key', normalized,
          'reason', coalesce(reason, ''),
          'requested_by_email', coalesce(actor_email, '')
        )
      );
    end if;
    raise;
end;
$$;
