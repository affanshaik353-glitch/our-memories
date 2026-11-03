import io
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bleach
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from itsdangerous import BadSignature, TimestampSigner
from passlib.context import CryptContext
from PIL import Image, ImageOps
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5500").rstrip("/")
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-this-development-secret")
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
signer = TimestampSigner(SESSION_SECRET, salt="our-memories-admin")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="OUR MEMORIES API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:5500", "http://127.0.0.1:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_COOKIE = "memory_admin"
ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 15 * 1024 * 1024


def ensure_admin(request: Request):
    raw = request.cookies.get(ADMIN_COOKIE)
    if not raw:
        raise HTTPException(401, "Admin authentication required")
    try:
        value = signer.unsign(raw, max_age=28800).decode()
    except (BadSignature, UnicodeDecodeError):
        raise HTTPException(401, "Admin session is invalid or expired")
    if value != "authenticated":
        raise HTTPException(401, "Admin authentication required")


def data(result):
    if getattr(result, "data", None) is None:
        raise HTTPException(500, "Database operation failed")
    return result.data


async def visitor(request: Request):
    token = request.cookies.get("memory_visitor")
    if not token or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
        token = secrets.token_urlsafe(32)
        request.state.new_visitor_token = token
    result = supabase.table("visitor_identities").select("id,display_name").eq("visitor_token", token).execute()
    rows = data(result)
    if rows:
        return rows[0], token
    created = supabase.table("visitor_identities").insert({"visitor_token": token}).execute()
    return data(created)[0], token


def add_visitor_cookie(response, request):
    token = getattr(request.state, "new_visitor_token", None)
    if token:
        response.set_cookie(
            "memory_visitor", token, max_age=31536000, httponly=True, samesite="none" if SESSION_COOKIE_SECURE else "lax",
            secure=SESSION_COOKIE_SECURE, path="/"
        )


def clean_text(value: str, max_length: int) -> str:
    value = bleach.clean(value or "", tags=[], attributes={}, strip=True).strip()
    if len(value) > max_length:
        raise HTTPException(422, f"Text must be at most {max_length} characters")
    if not value:
        raise HTTPException(422, "Text cannot be empty")
    return value


@app.on_event("startup")
async def bootstrap_admin():
    admin_id = os.getenv("ADMIN_ID")
    password = os.getenv("ADMIN_PASSWORD")
    if not admin_id or not password:
        raise RuntimeError("ADMIN_ID and ADMIN_PASSWORD are required")
    existing = supabase.table("admin_users").select("id").eq("admin_id", admin_id).execute()
    if not existing.data:
        supabase.table("admin_users").insert({
            "admin_id": admin_id,
            "password_hash": pwd_context.hash(password),
        }).execute()


@app.post("/api/auth/login")
@limiter.limit("5/minute")
async def login(request: Request):
    payload = await request.json()
    admin_id = clean_text(payload.get("admin_id", ""), 100)
    password = payload.get("password", "")
    if len(password) > 256:
        raise HTTPException(422, "Invalid password")
    rows = supabase.table("admin_users").select("password_hash").eq("admin_id", admin_id).execute().data
    valid = bool(rows and pwd_context.verify(password, rows[0]["password_hash"]))
    if not valid:
        raise HTTPException(401, "Invalid admin credentials")
    response = JSONResponse({"ok": True})
    response.set_cookie(
        ADMIN_COOKIE, signer.sign("authenticated").decode(), httponly=True,
        max_age=28800, secure=SESSION_COOKIE_SECURE, samesite="none" if SESSION_COOKIE_SECURE else "lax",
        path="/"
    )
    return response


@app.post("/api/auth/logout")
async def logout(_: Request = Depends(ensure_admin)):
    response = JSONResponse({"ok": True})
    response.delete_cookie(ADMIN_COOKIE, path="/")
    return response


@app.get("/api/auth/session")
async def session(_: Request = Depends(ensure_admin)):
    return {"authenticated": True}


@app.get("/api/config")
async def config(request: Request):
    visitor_row, _ = await visitor(request)
    response = JSONResponse({
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
        "ok": True
    })
    add_visitor_cookie(response, request)
    return response


@app.get("/api/gallery")
async def gallery(request: Request):
    visitor_row, _ = await visitor(request)
    photos = supabase.table("photos").select("*").order("uploaded_at", desc=True).execute().data or []
    albums = supabase.table("albums").select("*").order("created_at", desc=True).execute().data or []
    theme_result = supabase.table("website_themes").select("*").eq("active", True).limit(1).execute()
    theme = theme_result.data[0] if theme_result.data else {}
    like_rows = supabase.table("likes").select("photo_id,visitor_id").execute().data or []
    comment_rows = supabase.table("comments").select("id,photo_id,visitor_id,display_name,body,created_at").order("created_at").execute().data or []
    for photo in photos:
        photo["like_count"] = sum(1 for like in like_rows if like["photo_id"] == photo["id"])
        photo["liked_by_visitor"] = any(like["photo_id"] == photo["id"] and like["visitor_id"] == visitor_row["id"] for like in like_rows)
        photo["comment_count"] = sum(1 for comment in comment_rows if comment["photo_id"] == photo["id"])
        photo["comments"] = [comment for comment in comment_rows if comment["photo_id"] == photo["id"]]
    response = JSONResponse({"photos": photos, "albums": albums, "theme": theme, "visitor": {"id": visitor_row["id"], "display_name": visitor_row["display_name"]}})
    add_visitor_cookie(response, request)
    return response


@app.post("/api/visitor")
@limiter.limit("10/minute")
async def save_visitor(request: Request):
    row, _ = await visitor(request)
    payload = await request.json()
    name = clean_text(payload.get("display_name", ""), 40)
    supabase.table("visitor_identities").update({
        "display_name": name, "updated_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", row["id"]).execute()
    response = JSONResponse({"ok": True, "display_name": name})
    add_visitor_cookie(response, request)
    return response


@app.post("/api/photos/{photo_id}/like")
@limiter.limit("20/minute")
async def toggle_like(photo_id: str, request: Request):
    row, _ = await visitor(request)
    existing = supabase.table("likes").select("id").eq("photo_id", photo_id).eq("visitor_id", row["id"]).execute().data
    if existing:
        supabase.table("likes").delete().eq("id", existing[0]["id"]).execute()
        liked = False
    else:
        supabase.table("likes").insert({"photo_id": photo_id, "visitor_id": row["id"]}).execute()
        liked = True
    response = JSONResponse({"ok": True, "liked": liked})
    add_visitor_cookie(response, request)
    return response


@app.post("/api/photos/{photo_id}/comments")
@limiter.limit("12/minute")
async def add_comment(photo_id: str, request: Request):
    row, _ = await visitor(request)
    payload = await request.json()
    body = clean_text(payload.get("body", ""), 500)
    name = clean_text(payload.get("display_name", "") or row.get("display_name") or "Memory Lover", 40)
    if len(set(re.findall(r"\S+", body.lower()))) < 1:
        raise HTTPException(422, "Comment cannot be empty")
    if re.search(r"https?://|www\.", body, re.I):
        raise HTTPException(422, "Links are not allowed in comments")
    if not supabase.table("photos").select("id").eq("id", photo_id).execute().data:
        raise HTTPException(404, "Photo not found")
    created = supabase.table("comments").insert({
        "photo_id": photo_id, "visitor_id": row["id"], "display_name": name, "body": body
    }).execute()
    supabase.table("visitor_identities").update({"display_name": name}).eq("id", row["id"]).execute()
    response = JSONResponse({"ok": True, "comment": data(created)[0]})
    add_visitor_cookie(response, request)
    return response


@app.post("/api/albums")
async def create_album(request: Request, _: None = Depends(ensure_admin)):
    payload = await request.json()
    name = clean_text(payload.get("name", ""), 80)
    created = supabase.table("albums").insert({"name": name}).execute()
    return {"ok": True, "album": data(created)[0]}


@app.delete("/api/albums/{album_id}")
async def delete_album(album_id: str, _: None = Depends(ensure_admin)):
    supabase.table("photos").update({"album_id": None}).eq("album_id", album_id).execute()
    supabase.table("albums").delete().eq("id", album_id).execute()
    return {"ok": True}


async def process_image(upload: UploadFile):
    if upload.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Use JPEG, PNG, or WebP images")
    image_bytes = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is larger than 15 MB")
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            source.verify()
        with Image.open(io.BytesIO(image_bytes)) as source:
            converted = ImageOps.exif_transpose(source).convert("RGB")
            converted.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            converted.save(output, format="JPEG", quality=88, optimize=True)
            return output.getvalue()
    except Exception as exc:
        raise HTTPException(415, "The uploaded file is not a valid image") from exc


@app.post("/api/photos")
async def upload_photo(
    request: Request,
    _: None = Depends(ensure_admin),
    file: UploadFile = File(...),
    title: str = Form(...),
    caption: str = Form(""),
    album_id: Optional[str] = Form(None),
):
    title = clean_text(title, 100)
    caption = clean_text(caption, 500) if caption else ""
    if album_id:
        if not supabase.table("albums").select("id").eq("id", album_id).execute().data:
            raise HTTPException(422, "Album does not exist")
    image_bytes = await process_image(file)
    storage_path = f"{datetime.now(timezone.utc).strftime('%Y/%m/%d')}/{uuid.uuid4()}.jpg"
    try:
        supabase.storage.from_("memory-photos").upload(
            storage_path, image_bytes, {"content-type": "image/jpeg", "cache-control": "3600", "upsert": "false"}
        )
    except Exception as exc:
        raise HTTPException(500, "Image upload failed") from exc
    public_url = supabase.storage.from_("memory-photos").get_public_url(storage_path)
    created = supabase.table("photos").insert({
        "title": title, "caption": caption, "album_id": album_id or None,
        "storage_path": storage_path, "public_url": public_url
    }).execute()
    return {"ok": True, "photo": data(created)[0]}


@app.patch("/api/photos/{photo_id}")
async def update_photo(photo_id: str, request: Request, _: None = Depends(ensure_admin)):
    payload = await request.json()
    updates = {}
    if "title" in payload:
        updates["title"] = clean_text(payload["title"], 100)
    if "caption" in payload:
        updates["caption"] = clean_text(payload["caption"], 500) if payload["caption"] else ""
    if "album_id" in payload:
        updates["album_id"] = payload["album_id"] or None
    if "featured" in payload:
        updates["featured"] = bool(payload["featured"])
    if not updates:
        raise HTTPException(422, "No valid changes supplied")
    updated = supabase.table("photos").update(updates).eq("id", photo_id).execute()
    if not data(updated):
        raise HTTPException(404, "Photo not found")
    return {"ok": True, "photo": data(updated)[0]}


@app.delete("/api/photos/{photo_id}")
async def delete_photo(photo_id: str, _: None = Depends(ensure_admin)):
    rows = supabase.table("photos").select("storage_path").eq("id", photo_id).execute().data
    if not rows:
        raise HTTPException(404, "Photo not found")
    supabase.table("photos").delete().eq("id", photo_id).execute()
    supabase.storage.from_("memory-photos").remove([rows[0]["storage_path"]])
    return {"ok": True}


@app.put("/api/theme")
async def save_theme(request: Request, _: None = Depends(ensure_admin)):
    payload = await request.json()
    allowed_fonts = {"Nunito", "Georgia", "Verdana", "Trebuchet MS", "Comic Sans MS"}
    font = payload.get("font_family", "Nunito")
    if font not in allowed_fonts:
        raise HTTPException(422, "Unsupported font")
    update = {
        "theme_name": clean_text(payload.get("theme_name", "love"), 30),
        "background": clean_text(payload.get("background", "#fff0f7"), 30),
        "colors": payload.get("colors", {}),
        "font_family": font,
        "background_image": payload.get("background_image"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    current = supabase.table("website_themes").select("id").eq("active", True).limit(1).execute().data
    if current:
        supabase.table("website_themes").update(update).eq("id", current[0]["id"]).execute()
    else:
        supabase.table("website_themes").insert({"active": True, **update}).execute()
    theme = supabase.table("website_themes").select("*").eq("active", True).single().execute().data
    return {"ok": True, "theme": theme}


@app.post("/api/theme/background")
async def upload_background(
    _: None = Depends(ensure_admin),
    file: UploadFile = File(...),
):
    image_bytes = await process_image(file)
    storage_path = f"themes/{uuid.uuid4()}.jpg"
    supabase.storage.from_("memory-photos").upload(
        storage_path, image_bytes, {"content-type": "image/jpeg", "upsert": "false"}
    )
    return {"ok": True, "url": supabase.storage.from_("memory-photos").get_public_url(storage_path)}
