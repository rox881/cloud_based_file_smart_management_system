-- Permanent RLS for multi-user document access + storage paths
-- Safe to run multiple times.

-- 1) Documents table policies
ALTER TABLE IF EXISTS public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_select_own" ON public.documents;
CREATE POLICY "documents_select_own"
ON public.documents
FOR SELECT
TO authenticated
USING (
  owner_user_id = auth.uid()
  OR created_by = COALESCE(auth.jwt() ->> 'email', '')
);

DROP POLICY IF EXISTS "documents_insert_own" ON public.documents;
CREATE POLICY "documents_insert_own"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  OR created_by = COALESCE(auth.jwt() ->> 'email', '')
);

DROP POLICY IF EXISTS "documents_update_own" ON public.documents;
CREATE POLICY "documents_update_own"
ON public.documents
FOR UPDATE
TO authenticated
USING (
  owner_user_id = auth.uid()
  OR created_by = COALESCE(auth.jwt() ->> 'email', '')
)
WITH CHECK (
  owner_user_id = auth.uid()
  OR created_by = COALESCE(auth.jwt() ->> 'email', '')
);

DROP POLICY IF EXISTS "documents_delete_own" ON public.documents;
CREATE POLICY "documents_delete_own"
ON public.documents
FOR DELETE
TO authenticated
USING (
  owner_user_id = auth.uid()
  OR created_by = COALESCE(auth.jwt() ->> 'email', '')
);

-- 2) Storage policies for bucket: documents
-- Path rule: users/<auth.uid()>/...

DROP POLICY IF EXISTS "storage_documents_select_own" ON storage.objects;
CREATE POLICY "storage_documents_select_own"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents'
  AND split_part(name, '/', 1) = 'users'
  AND split_part(name, '/', 2) = auth.uid()::text
);

DROP POLICY IF EXISTS "storage_documents_insert_own" ON storage.objects;
CREATE POLICY "storage_documents_insert_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents'
  AND split_part(name, '/', 1) = 'users'
  AND split_part(name, '/', 2) = auth.uid()::text
);

DROP POLICY IF EXISTS "storage_documents_update_own" ON storage.objects;
CREATE POLICY "storage_documents_update_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents'
  AND split_part(name, '/', 1) = 'users'
  AND split_part(name, '/', 2) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'documents'
  AND split_part(name, '/', 1) = 'users'
  AND split_part(name, '/', 2) = auth.uid()::text
);

DROP POLICY IF EXISTS "storage_documents_delete_own" ON storage.objects;
CREATE POLICY "storage_documents_delete_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents'
  AND split_part(name, '/', 1) = 'users'
  AND split_part(name, '/', 2) = auth.uid()::text
);
