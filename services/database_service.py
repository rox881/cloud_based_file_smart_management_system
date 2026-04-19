from typing import Any

from supabase import Client


class DatabaseService:
    def __init__(self, supabase_client: Client) -> None:
        self.supabase = supabase_client

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
    ) -> Any:
        payload = {
            "file_name": file_name,
            "folder_location": folder_location,
            "content_text": content_text,
            "file_size": file_size,
            "mime_type": mime_type,
            "category": category or "uncategorized",
            "confidence": float(confidence or 0),
            "status": status,
        }
        response = self.supabase.table("documents").upsert(payload).execute()
        print(f"[table.insert] file={file_name} path={folder_location} response={self.debug_payload(response)}")
        return response

    def create_file_share(
        self,
        file_name: str,
        storage_path: str,
        recipient_email: str,
        share_token: str,
        permission: str = "view",
        status: str = "pending",
        message: str | None = None,
        expires_at: str | None = None,
    ) -> Any:
        payload = {
            "file_name": file_name,
            "storage_path": storage_path,
            "recipient_email": recipient_email,
            "permission": permission,
            "share_token": share_token,
            "status": status,
            "message": message,
            "expires_at": expires_at,
        }
        response = self.supabase.table("file_shares").insert(payload).execute()
        print(
            f"[table.insert] share_token={share_token} file={file_name} recipient={recipient_email} "
            f"response={self.debug_payload(response)}"
        )
        return response

    def list_file_shares(self, limit: int = 20) -> Any:
        safe_limit = max(1, min(int(limit), 100))
        response = (
            self.supabase.table("file_shares")
            .select("id,file_name,storage_path,recipient_email,permission,status,share_token,message,created_at,expires_at")
            .order("created_at", desc=True)
            .limit(safe_limit)
            .execute()
        )
        print(f"[shares.list] limit={safe_limit} response={self.debug_payload(response)}")
        return response

    def update_file_share_status(self, share_token: str, status: str) -> Any:
        response = (
            self.supabase.table("file_shares")
            .update({"status": status})
            .eq("share_token", share_token)
            .execute()
        )
        print(f"[shares.update] share_token={share_token} status={status} response={self.debug_payload(response)}")
        return response

    def search_documents(self, query: str) -> Any:
        response = (
            self.supabase.table("documents")
            .select("file_name,folder_location,file_size,mime_type,category,confidence,status")
            .text_search("search_vector", query)
            .execute()
        )
        print(f"[search.response] payload={self.debug_payload(response)}")
        return response

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
