-- Migration: support summaries and hash-based duplicate detection
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS summary_text text,
ADD COLUMN IF NOT EXISTS content_hash text;

-- Speed up exact duplicate checks per user
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON public.documents (content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_owner_hash ON public.documents (owner_user_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_creator_hash ON public.documents (created_by, content_hash);
