-- Rename draft-era relational objects to chat-era names.
-- Safe to run on databases that may already be partially migrated.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'recipes'
      AND column_name = 'source_draft_id'
  ) THEN
    ALTER TABLE public.recipes RENAME COLUMN source_draft_id TO source_chat_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'recipe_drafts'
  ) THEN
    ALTER TABLE public.recipe_drafts RENAME TO chat_sessions;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'recipe_draft_messages'
  ) THEN
    ALTER TABLE public.recipe_draft_messages RENAME TO chat_messages;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'draft_id'
  ) THEN
    ALTER TABLE public.chat_messages RENAME COLUMN draft_id TO chat_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'recipe_draft_messages_draft_idx'
  ) THEN
    ALTER INDEX public.recipe_draft_messages_draft_idx RENAME TO chat_messages_chat_idx;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_sessions'
      AND policyname = 'recipe_drafts_owner_rw'
  ) THEN
    ALTER POLICY recipe_drafts_owner_rw ON public.chat_sessions RENAME TO chat_sessions_owner_rw;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_messages'
      AND policyname = 'recipe_draft_messages_owner_rw'
  ) THEN
    ALTER POLICY recipe_draft_messages_owner_rw ON public.chat_messages RENAME TO chat_messages_owner_rw;
  END IF;
END;
$$;
