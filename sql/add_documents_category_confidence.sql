ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS category text,
ADD COLUMN IF NOT EXISTS confidence numeric;
