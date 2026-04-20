import re
from typing import Any

from supabase import Client


# Sentinel to cache whether the created_by column exists
_CREATED_BY_COLUMN_EXISTS: bool | None = None
_OWNER_USER_ID_COLUMN_EXISTS: bool | None = None
_SUMMARY_TEXT_COLUMN_EXISTS: bool | None = None
_CONTENT_HASH_COLUMN_EXISTS: bool | None = None


def _has_created_by(supabase: Client) -> bool:
    """Check once (per process) whether the created_by column exists."""
    global _CREATED_BY_COLUMN_EXISTS
    if _CREATED_BY_COLUMN_EXISTS is not None:
        return _CREATED_BY_COLUMN_EXISTS
    try:
        supabase.table("documents").select("id, created_by").limit(1).execute()
        _CREATED_BY_COLUMN_EXISTS = True
    except Exception as e:
        if "created_by" in str(e).lower() or "42703" in str(e):
            _CREATED_BY_COLUMN_EXISTS = False
        else:
            # Unknown error — assume column doesn't exist to stay safe
            _CREATED_BY_COLUMN_EXISTS = False
    return _CREATED_BY_COLUMN_EXISTS


def _has_owner_user_id(supabase: Client) -> bool:
    """Check once (per process) whether the owner_user_id column exists."""
    global _OWNER_USER_ID_COLUMN_EXISTS
    if _OWNER_USER_ID_COLUMN_EXISTS is not None:
        return _OWNER_USER_ID_COLUMN_EXISTS
    try:
        supabase.table("documents").select("id, owner_user_id").limit(1).execute()
        _OWNER_USER_ID_COLUMN_EXISTS = True
    except Exception as e:
        if "owner_user_id" in str(e).lower() or "42703" in str(e):
            _OWNER_USER_ID_COLUMN_EXISTS = False
        else:
            _OWNER_USER_ID_COLUMN_EXISTS = False
    return _OWNER_USER_ID_COLUMN_EXISTS


def _has_summary_text(supabase: Client) -> bool:
    """Check once (per process) whether the summary_text column exists."""
    global _SUMMARY_TEXT_COLUMN_EXISTS
    if _SUMMARY_TEXT_COLUMN_EXISTS is not None:
        return _SUMMARY_TEXT_COLUMN_EXISTS
    try:
        supabase.table("documents").select("id, summary_text").limit(1).execute()
        _SUMMARY_TEXT_COLUMN_EXISTS = True
    except Exception as e:
        if "summary_text" in str(e).lower() or "42703" in str(e):
            _SUMMARY_TEXT_COLUMN_EXISTS = False
        else:
            _SUMMARY_TEXT_COLUMN_EXISTS = False
    return _SUMMARY_TEXT_COLUMN_EXISTS


def _has_content_hash(supabase: Client) -> bool:
    """Check once (per process) whether the content_hash column exists."""
    global _CONTENT_HASH_COLUMN_EXISTS
    if _CONTENT_HASH_COLUMN_EXISTS is not None:
        return _CONTENT_HASH_COLUMN_EXISTS
    try:
        supabase.table("documents").select("id, content_hash").limit(1).execute()
        _CONTENT_HASH_COLUMN_EXISTS = True
    except Exception as e:
        if "content_hash" in str(e).lower() or "42703" in str(e):
            _CONTENT_HASH_COLUMN_EXISTS = False
        else:
            _CONTENT_HASH_COLUMN_EXISTS = False
    return _CONTENT_HASH_COLUMN_EXISTS


class DatabaseService:
    def __init__(self, supabase_client: Client, auth_client: Client | None = None) -> None:
        self.supabase = supabase_client
        # Keep auth operations isolated so user-session changes do not affect
        # backend storage/table calls that must run with service-role context.
        self.auth_supabase = auth_client or supabase_client

    def _document_select_columns(self, include_content_text: bool = False) -> str:
        cols = [
            "id",
            "file_name",
            "folder_location",
            "file_size",
            "mime_type",
            "category",
            "confidence",
            "status",
        ]
        if include_content_text:
            cols.append("content_text")
        if _has_created_by(self.supabase):
            cols.append("created_by")
        if _has_owner_user_id(self.supabase):
            cols.append("owner_user_id")
        if _has_summary_text(self.supabase):
            cols.append("summary_text")
        if _has_content_hash(self.supabase):
            cols.append("content_hash")
        return ",".join(cols)

    def _apply_user_scope(self, req: Any, created_by: str = "", user_id: str = "") -> Any:
        col_exists = _has_created_by(self.supabase)
        owner_col_exists = _has_owner_user_id(self.supabase)
        if created_by and col_exists:
            return req.eq("created_by", created_by)
        if user_id and owner_col_exists:
            return req.eq("owner_user_id", user_id)
        if user_id:
            return req.ilike("folder_location", f"users/{user_id}/%")
        return req

    @staticmethod
    def _safe_like_token(token: str) -> str:
        # Keep a compact token to avoid malformed OR filters.
        return re.sub(r"[^a-zA-Z0-9_-]", "", (token or "").strip())

    # ── Auth ──────────────────────────────────────────────────────

    def sign_up(self, email: str, password: str, name: str) -> Any:
        """
        Creates a user. Uses Admin API to auto-confirm email, 
        bypassing Supabase's email rate limits.
        """
        try:
            # We use the admin API to bypass email confirmation / rate limits
            response = self.auth_supabase.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"full_name": name}
            })
            # Admin create_user returns UserResponse, we want to return it 
            # so app.py can extract the user info. Note: No session is returned.
            return response
        except Exception as e:
            # If admin creation fails (e.g. user exists), we return the error
            # so app.py can handle it (like 409 Conflict)
            err_msg = str(e).lower()
            if "already registered" in err_msg or "already exists" in err_msg:
                # Re-raise with a clear message for the controller
                raise Exception("An account with this email already exists.") from e
            
            # Fallback to standard signup if admin isn't working for some reason
            print(f"[auth.admin.signup.failed] {e} -> fallback to standard signup")
            return self.auth_supabase.auth.sign_up({
                "email": email,
                "password": password,
                "options": {"data": {"full_name": name}}
            })

    def sign_in(self, email: str, password: str) -> Any:
        try:
            response = self.auth_supabase.auth.sign_in_with_password({
                "email": email,
                "password": password
            })
            return response
        except Exception as e:
            if "email not confirmed" in str(e).lower():
                # Auto-confirm the user if they were stuck
                print(f"[auth.signin] Auto-confirming unconfirmed user: {email}")
                self.confirm_user_by_email(email)
                # Retry sign-in
                return self.auth_supabase.auth.sign_in_with_password({
                    "email": email,
                    "password": password
                })
            raise e

    def refresh_session(self, refresh_token: str) -> Any:
        """Refresh an expired access token using a refresh token."""
        if not refresh_token:
            raise ValueError("Missing refresh token")

        # supabase-py signatures may vary by version.
        try:
            return self.auth_supabase.auth.refresh_session(refresh_token)
        except TypeError:
            return self.auth_supabase.auth.refresh_session({"refresh_token": refresh_token})

    def resolve_login_identifier_to_email(self, identifier: str) -> str:
        """Allow login with either email or username-like identifier."""
        ident = (identifier or "").strip()
        if not ident:
            return ""
        if "@" in ident:
            return ident.lower()

        # If a username is provided, map it to email via auth admin users.
        try:
            users_res = self.auth_supabase.auth.admin.list_users()
            users = users_res if isinstance(users_res, list) else getattr(users_res, "users", [])
            ident_lower = ident.lower()

            for u in users:
                email = str(getattr(u, "email", "") or "").strip().lower()
                full_name = str((getattr(u, "user_metadata", {}) or {}).get("full_name", "") or "").strip().lower()
                if not email:
                    continue

                # Match username by exact email local-part or exact full name.
                local_part = email.split("@", 1)[0]
                if ident_lower == local_part or ident_lower == full_name:
                    return email
        except Exception as exc:
            print(f"[auth.resolve.identifier.failed] {exc}")

        # Fall back to original text so caller can return a normal auth error.
        return ident.lower()

    def get_user_identity_from_token(self, access_token: str) -> dict[str, str]:
        """Resolve user identity fields from a Supabase access token."""
        if not access_token:
            return {"email": "", "id": ""}

        # Support multiple supabase-py auth signatures across versions.
        response = None
        try:
            response = self.auth_supabase.auth.get_user(access_token)
        except TypeError:
            response = self.auth_supabase.auth.get_user(jwt=access_token)

        user = getattr(response, "user", None)
        if user is None and isinstance(response, dict):
            user = response.get("user") or (response.get("data") or {}).get("user")

        if user is None:
            return {"email": "", "id": ""}

        if isinstance(user, dict):
            return {
                "email": str(user.get("email") or "").strip().lower(),
                "id": str(user.get("id") or "").strip(),
            }
        return {
            "email": str(getattr(user, "email", "") or "").strip().lower(),
            "id": str(getattr(user, "id", "") or "").strip(),
        }

    def get_user_email_from_token(self, access_token: str) -> str:
        """Backward-compatible helper for existing callers."""
        return self.get_user_identity_from_token(access_token).get("email", "")

    def confirm_user_by_email(self, email: str) -> bool:
        """Finds a user by email and forces email_confirm=True via Admin API."""
        try:
            # list_users doesn't support server-side filtering in most py clients yet, 
            # so we fetch and find (usually fine for small dev projects)
            users_res = self.auth_supabase.auth.admin.list_users()
            # Depending on version, it might be a list or have a 'users' attribute
            users = users_res if isinstance(users_res, list) else getattr(users_res, 'users', [])
            
            for u in users:
                if getattr(u, 'email', '').lower() == email.lower():
                    self.auth_supabase.auth.admin.update_user_by_id(
                        u.id, 
                        {"email_confirm": True}
                    )
                    return True
        except Exception as exc:
            print(f"[auth.admin.confirm.failed] {exc}")
        return False

    # ── Storage ───────────────────────────────────────────────────

    def upload_to_storage(self, bucket: str, object_path: str, file_bytes: bytes, content_type: str) -> Any:
        response = self.supabase.storage.from_(bucket).upload(
            object_path,
            file_bytes,
            {"upsert": "true", "content-type": content_type or "application/octet-stream"},
        )
        print(f"[storage.upload] bucket={bucket} path={object_path} response={response}")
        return response

    def move_storage_object(self, bucket: str, old_path: str, new_path: str) -> Any:
        response = self.supabase.storage.from_(bucket).move(old_path, new_path)
        print(f"[storage.move] bucket={bucket} from={old_path} to={new_path} response={response}")
        return response

    # ── Documents ─────────────────────────────────────────────────

    def insert_document(
        self,
        file_name: str,
        folder_location: str,
        content_text: str,
        file_size: int,
        mime_type: str,
        category: str = "uncategorized",
        confidence: float = 0,
        status: str = "auto-classified",
        created_by: str = "",
        owner_user_id: str = "",
        summary_text: str = "",
        content_hash: str = "",
    ) -> Any:
        payload: dict[str, Any] = {
            "file_name": file_name,
            "folder_location": folder_location,
            "content_text": content_text,
            "file_size": file_size,
            "mime_type": mime_type,
            "category": category or "uncategorized",
            "confidence": float(confidence or 0),
            "status": status,
        }

        # Only include created_by if the column exists
        if _has_created_by(self.supabase) and created_by:
            payload["created_by"] = created_by
        if _has_owner_user_id(self.supabase) and owner_user_id:
            payload["owner_user_id"] = owner_user_id
        if _has_summary_text(self.supabase):
            payload["summary_text"] = summary_text or ""
        if _has_content_hash(self.supabase) and content_hash:
            payload["content_hash"] = content_hash

        try:
            response = self.supabase.table("documents").upsert(payload).execute()
            print(
                f"[table.insert] file={file_name} path={folder_location} "
                f"created_by={created_by if _has_created_by(self.supabase) else '(column missing)'} "
                f"response={self.debug_payload(response)}"
            )
            return response
        except Exception as exc:  # noqa: BLE001
            # Emit detailed debug info to help diagnose RLS / permission issues.
            err_text = str(exc)
            print(f"[table.insert.error] file={file_name} path={folder_location} error={err_text}")
            try:
                # If the supabase client returned a response-like object, attempt to log it.
                import json

                if hasattr(exc, "args") and exc.args:
                    try:
                        print("[table.insert.error.args]", json.dumps(exc.args[0], default=str))
                    except Exception:
                        print("[table.insert.error.args.raw]", exc.args)
            except Exception:
                pass
            raise

    def search_documents(self, query: str, created_by: str = "", user_id: str = "") -> Any:
        select_cols = self._document_select_columns(include_content_text=False)

        # Primary path: PostgreSQL full-text search (best quality when search_vector is present).
        try:
            fts_req = self._apply_user_scope(
                self.supabase.table("documents").select(select_cols).text_search("search_vector", query),
                created_by=created_by,
                user_id=user_id,
            )
            fts_response = fts_req.execute()
            if fts_response.data:
                print(f"[search.response.fts] payload={self.debug_payload(fts_response)}")
                return fts_response
            print("[search.response.fts] empty result set; switching to ilike fallback")
        except Exception as exc:  # noqa: BLE001
            print(f"[search.response.fts.error] {exc}; switching to ilike fallback")

        # Fallback path: tokenized ILIKE search that works even without search_vector.
        raw_tokens = [part for part in re.split(r"\s+", (query or "").strip()) if part]
        safe_tokens: list[str] = []
        for token in raw_tokens[:8]:
            clean = self._safe_like_token(token)
            if clean and clean not in safe_tokens:
                safe_tokens.append(clean)

        fallback_req = self._apply_user_scope(
            self.supabase.table("documents").select(select_cols),
            created_by=created_by,
            user_id=user_id,
        )

        or_clauses: list[str] = []
        for token in safe_tokens:
            pattern = f"%{token}%"
            or_clauses.extend(
                [
                    f"file_name.ilike.{pattern}",
                    f"category.ilike.{pattern}",
                    f"mime_type.ilike.{pattern}",
                    f"content_text.ilike.{pattern}",
                ]
            )
            if _has_summary_text(self.supabase):
                or_clauses.append(f"summary_text.ilike.{pattern}")

        if or_clauses:
            fallback_req = fallback_req.or_(",".join(or_clauses))

        fallback_response = fallback_req.order("id", desc=True).limit(200).execute()
        print(f"[search.response.fallback] payload={self.debug_payload(fallback_response)}")
        return fallback_response

    def get_documents_by_user(self, created_by: str, user_id: str = "") -> Any:
        """Return documents for the given user. Falls back to all docs if column missing."""
        col_exists = _has_created_by(self.supabase)
        owner_col_exists = _has_owner_user_id(self.supabase)
        select_cols = self._document_select_columns(include_content_text=False)

        req = (
            self.supabase.table("documents")
            .select(select_cols)
            .order("id", desc=True)
        )
        if created_by and col_exists:
            req = req.eq("created_by", created_by)
        elif user_id and owner_col_exists:
            req = req.eq("owner_user_id", user_id)
        elif user_id:
            req = req.ilike("folder_location", f"users/{user_id}/%")

        response = req.execute()
        print(
            f"[get_documents_by_user] created_by={created_by} "
            f"col_exists={col_exists} count={len(response.data or [])}"
        )
        return response

    def get_documents_for_similarity(self, created_by: str = "", user_id: str = "", limit: int = 300) -> list[dict[str, Any]]:
        """Return user-scoped docs with content for semantic search and dedup checks."""
        col_exists = _has_created_by(self.supabase)
        owner_col_exists = _has_owner_user_id(self.supabase)
        req = (
            self.supabase.table("documents")
            .select(self._document_select_columns(include_content_text=True))
            .order("id", desc=True)
            .limit(max(1, min(limit, 1000)))
        )
        if created_by and col_exists:
            req = req.eq("created_by", created_by)
        elif user_id and owner_col_exists:
            req = req.eq("owner_user_id", user_id)
        elif user_id:
            req = req.ilike("folder_location", f"users/{user_id}/%")

        response = req.execute()
        docs = response.data or []
        print(f"[similarity.candidates] count={len(docs)}")
        return docs

    def find_exact_duplicate_by_hash(
        self,
        content_hash: str,
        created_by: str = "",
        user_id: str = "",
    ) -> dict[str, Any] | None:
        """Return first matching document for a hash in the same user scope."""
        if not content_hash:
            return None
        if not _has_content_hash(self.supabase):
            return None

        col_exists = _has_created_by(self.supabase)
        owner_col_exists = _has_owner_user_id(self.supabase)
        select_cols = ["id", "file_name", "folder_location", "status"]
        if col_exists:
            select_cols.append("created_by")
        if owner_col_exists:
            select_cols.append("owner_user_id")
        req = (
            self.supabase.table("documents")
            .select(",".join(select_cols))
            .eq("content_hash", content_hash)
            .order("id", desc=True)
            .limit(1)
        )
        if created_by and col_exists:
            req = req.eq("created_by", created_by)
        elif user_id and owner_col_exists:
            req = req.eq("owner_user_id", user_id)
        elif user_id:
            req = req.ilike("folder_location", f"users/{user_id}/%")

        response = req.execute()
        data = response.data or []
        return data[0] if data else None

    def get_user_stats(self, created_by: str, user_id: str = "") -> dict[str, Any]:
        """Calculates total storage used by the user and total documents limit."""
        col_exists = _has_created_by(self.supabase)
        owner_col_exists = _has_owner_user_id(self.supabase)
        req = self.supabase.table("documents").select("file_size")
        if created_by and col_exists:
            req = req.eq("created_by", created_by)
        elif user_id and owner_col_exists:
            req = req.eq("owner_user_id", user_id)
        elif user_id:
            req = req.ilike("folder_location", f"users/{user_id}/%")
        
        response = req.execute()
        doc_list = response.data or []
        
        total_size = sum(int(d.get("file_size") or 0) for d in doc_list)
        return {
            "total_bytes_used": total_size,
            "document_count": len(doc_list)
        }

    def user_owns_path(self, path: str, created_by: str = "", user_id: str = "") -> bool:
        """Check ownership for a storage path in the documents table."""
        if not path:
            return False

        if _has_created_by(self.supabase) and created_by:
            response = (
                self.supabase.table("documents")
                .select("id")
                .eq("folder_location", path)
                .eq("created_by", created_by)
                .limit(1)
                .execute()
            )
            return bool(response.data)

        if _has_owner_user_id(self.supabase) and user_id:
            response = (
                self.supabase.table("documents")
                .select("id")
                .eq("folder_location", path)
                .eq("owner_user_id", user_id)
                .limit(1)
                .execute()
            )
            return bool(response.data)

        if user_id:
            return path.startswith(f"users/{user_id}/")

        return False

    def get_user_document_by_path(self, path: str, created_by: str = "", user_id: str = "") -> dict[str, Any] | None:
        """Return a user-owned document row for a storage path."""
        if not path:
            return None

        col_exists = _has_created_by(self.supabase)
        owner_col_exists = _has_owner_user_id(self.supabase)
        select_cols = ["id", "file_name", "folder_location"]
        if col_exists:
            select_cols.append("created_by")
        if owner_col_exists:
            select_cols.append("owner_user_id")

        req = (
            self.supabase.table("documents")
            .select(",".join(select_cols))
            .eq("folder_location", path)
            .order("id", desc=True)
            .limit(1)
        )

        if created_by and col_exists:
            req = req.eq("created_by", created_by)
        elif user_id and owner_col_exists:
            req = req.eq("owner_user_id", user_id)
        elif user_id:
            req = req.ilike("folder_location", f"users/{user_id}/%")

        response = req.execute()
        data = response.data or []
        return data[0] if data else None

    def delete_user_document_by_path(self, path: str, created_by: str = "", user_id: str = "") -> bool:
        """Delete a user-owned document row by storage path."""
        doc = self.get_user_document_by_path(path, created_by=created_by, user_id=user_id)
        if not doc:
            return False
        doc_id = str(doc.get("id") or "").strip()
        if not doc_id:
            return False
        self.delete_document(doc_id)
        return True

    # ── Admin: Documents ──────────────────────────────────────────

    def get_all_documents(self) -> Any:
        response = self.supabase.table("documents").select("*").order("id", desc=True).execute()
        return response

    def get_document(self, doc_id: str) -> Any:
        response = self.supabase.table("documents").select("*").eq("id", doc_id).single().execute()
        return response

    def update_document(self, doc_id: str, payload: dict[str, Any]) -> Any:
        response = self.supabase.table("documents").update(payload).eq("id", doc_id).execute()
        return response

    def delete_document(self, doc_id: str) -> Any:
        response = self.supabase.table("documents").delete().eq("id", doc_id).execute()
        return response

    # ── Admin: Categories ─────────────────────────────────────────

    def get_all_categories(self) -> Any:
        response = self.supabase.table("document_categories").select("*").order("id", desc=True).execute()
        return response

    def create_category(self, payload: dict[str, Any]) -> Any:
        response = self.supabase.table("document_categories").insert(payload).execute()
        return response

    def update_category(self, cat_id: int, payload: dict[str, Any]) -> Any:
        response = self.supabase.table("document_categories").update(payload).eq("id", cat_id).execute()
        return response

    def delete_category(self, cat_id: int) -> Any:
        response = self.supabase.table("document_categories").delete().eq("id", cat_id).execute()
        return response

    # ── Storage helpers ───────────────────────────────────────────

    def get_download_url(self, path: str, expires_in: int = 120) -> str:
        result = self.supabase.storage.from_("documents").create_signed_url(path, expires_in)
        if isinstance(result, dict):
            return result.get("signedURL") or result.get("signedUrl", "")
        return str(result)

    def delete_storage_object(self, path: str) -> Any:
        response = self.supabase.storage.from_("documents").remove([path])
        return response

    # ── Admin: Stats ──────────────────────────────────────────────

    def get_admin_stats(self) -> dict[str, Any]:
        docs = self.supabase.table("documents").select("id,file_size,category,status").execute()
        cats = self.supabase.table("document_categories").select("id").execute()

        doc_list = docs.data or []
        total_docs = len(doc_list)
        total_cats = len(cats.data or [])
        classified = sum(1 for d in doc_list if (d.get("status") or "").lower() == "classified")
        total_size = sum(int(d.get("file_size") or 0) for d in doc_list)

        breakdown: dict[str, int] = {}
        for d in doc_list:
            cat = d.get("category") or "uncategorized"
            breakdown[cat] = breakdown.get(cat, 0) + 1

        return {
            "total_documents": total_docs,
            "total_categories": total_cats,
            "classified_count": classified,
            "uncategorized_count": total_docs - classified,
            "total_size_bytes": total_size,
            "category_breakdown": breakdown,
        }

    @staticmethod
    def debug_payload(response: Any) -> Any:
        if response is None:
            return None
        if isinstance(response, dict):
            return response
        if hasattr(response, "model_dump"):
            try:
                return response.model_dump()
            except Exception:  # noqa: BLE001
                return str(response)
        if hasattr(response, "data"):
            return {"data": getattr(response, "data")}
        return str(response)
