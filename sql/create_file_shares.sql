CREATE TABLE IF NOT EXISTS public.file_shares (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name text NOT NULL,
    storage_path text NOT NULL,
    recipient_email text NOT NULL,
    permission text NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'download')),
    share_token text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'accepted', 'revoked')),
    message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_file_shares_recipient_email ON public.file_shares (recipient_email);
CREATE INDEX IF NOT EXISTS idx_file_shares_storage_path ON public.file_shares (storage_path);
CREATE INDEX IF NOT EXISTS idx_file_shares_status ON public.file_shares (status);
