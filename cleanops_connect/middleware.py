from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4


@dataclass(slots=True)
class RequestContextMiddleware:
    def attach(self, request: dict[str, object]) -> dict[str, object]:
        return {**request, "request_id": request.get("request_id", str(uuid4()))}


@dataclass(slots=True)
class AuthMiddleware:
    bearer_prefix: str = "Bearer "

    def authorize(self, headers: dict[str, str]) -> dict[str, object]:
        normalized_headers = {key.lower(): value for key, value in headers.items()}
        token = normalized_headers.get("authorization", "")
        scheme, _, credential = token.partition(" ")
        authenticated = scheme.lower() == "bearer" and bool(credential.strip())
        return {"authenticated": authenticated, "token_present": bool(token)}
