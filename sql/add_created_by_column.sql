-- Migration: Add created_by column to documents table for access control
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS created_by text;

-- Optional: add an index for faster lookups by creator
CREATE INDEX IF NOT EXISTS idx_documents_created_by ON public.documents (created_by);
