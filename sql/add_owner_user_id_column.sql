-- Optional migration: add owner_user_id for stronger per-user filtering in documents table
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS owner_user_id uuid;

-- Optional index for faster user lookups
CREATE INDEX IF NOT EXISTS idx_documents_owner_user_id ON public.documents (owner_user_id);

-- Optional FK if desired (uncomment after validating existing values)
-- ALTER TABLE public.documents
-- ADD CONSTRAINT fk_documents_owner_user
-- FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
