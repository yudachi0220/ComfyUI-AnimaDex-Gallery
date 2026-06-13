"""
AnimaDex Gallery — ComfyUI 画廊插件。

两个独立节点:
  - AnimaDexCharacterGallery: 角色画廊 → 输出 trigger + tags
  - AnimaDexArtistGallery:    画师画廊 → 输出 trigger(@前缀,，分隔)

缓存: 内存缓存(1h TTL) + 自动持久化到 data/api_cache.json
"""

import json
import time
import threading
import urllib.request
import urllib.parse
from pathlib import Path

from server import PromptServer
from aiohttp import web

ANIMADEX_BASE = "https://animadex.net"
REQUEST_TIMEOUT = 15
USER_AGENT = "AnimaDex-Gallery/1.0"
CACHE_TTL = 3600
PAGE_SIZE = 9  # 每页9条

PLUGIN_DIR = Path(__file__).parent.parent
DATA_DIR = PLUGIN_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
FAVORITES_FILE = DATA_DIR / "favorites.json"
CACHE_FILE = DATA_DIR / "api_cache.json"

_cache_lock = threading.Lock()
_persist_lock = threading.Lock()

_mem_cache = {}
_favorites = {"characters": [], "artists": []}
_persist_timer = None


def _schedule_persist():
    """延迟持久化（500ms 防抖），避免频繁写盘"""
    global _persist_timer
    if _persist_timer:
        _persist_timer.cancel()
    _persist_timer = threading.Timer(0.5, _do_persist)
    _persist_timer.start()


def _do_persist():
    with _persist_lock:
        try:
            serializable = {}
            now = time.time()
            with _cache_lock:
                for k, (data, ts) in _mem_cache.items():
                    if now - ts < CACHE_TTL:
                        serializable[k] = (data, ts)
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(serializable, f, ensure_ascii=False)
        except Exception:
            pass


def _persist_favorites():
    with _persist_lock:
        try:
            with open(FAVORITES_FILE, "w", encoding="utf-8") as f:
                json.dump(_favorites, f, ensure_ascii=False)
        except Exception:
            pass


def _load_persisted():
    global _favorites
    try:
        if FAVORITES_FILE.exists():
            with open(FAVORITES_FILE, "r", encoding="utf-8") as f:
                _favorites = json.load(f)
    except Exception:
        _favorites = {"characters": [], "artists": []}

    try:
        if CACHE_FILE.exists():
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            now = time.time()
            with _cache_lock:
                for k, (data, ts) in saved.items():
                    if now - ts < CACHE_TTL:
                        _mem_cache[k] = (data, ts)
    except Exception:
        pass


def _cache_key(mode: str, params: dict) -> str:
    parts = [mode]
    for k in sorted(params.keys()):
        parts.append(f"{k}={params[k] or ''}")
    return "|".join(parts)


def _animadex_fetch(mode: str, params: dict) -> dict:
    key = _cache_key(mode, params)
    with _cache_lock:
        if key in _mem_cache:
            data, ts = _mem_cache[key]
            if time.time() - ts < CACHE_TTL:
                return data

    path = f"/api/{mode}/search"
    filtered = {k: v for k, v in params.items() if v is not None and v != ""}
    url = f"{ANIMADEX_BASE}{path}?{urllib.parse.urlencode(filtered)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        data = json.loads(resp.read().decode())

    with _cache_lock:
        _mem_cache[key] = (data, time.time())
    _schedule_persist()
    return data


def _animadex_facets(mode: str) -> dict:
    key = f"facets:{mode}"
    with _cache_lock:
        if key in _mem_cache:
            data, ts = _mem_cache[key]
            if time.time() - ts < CACHE_TTL:
                return data

    url = f"{ANIMADEX_BASE}/api/{mode}/facets"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        data = json.loads(resp.read().decode())

    with _cache_lock:
        _mem_cache[key] = (data, time.time())
    _schedule_persist()
    return data


_load_persisted()


# ============================================================
# 角色画廊节点
# ============================================================

class AnimaDexCharacterGallery:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "selection_data": ("STRING", {"default": "{}", "multiline": True, "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("trigger", "tags")
    FUNCTION = "get_selected_data"
    CATEGORY = "AnimaDex"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, selection_data="{}", **kwargs):
        return selection_data

    def get_selected_data(self, selection_data="{}", **kwargs):
        if not selection_data or selection_data == "{}":
            return ("", "")
        try:
            data = json.loads(selection_data)
            selections = data.get("selections", [])
            if not selections:
                return ("", "")
            triggers, all_tags, seen = [], [], set()
            for sel in selections:
                t = (sel.get("trigger") or "").strip()
                # 转义括号，和 animadex.net 网页显示一致
                t = t.replace("(", "\\(").replace(")", "\\)")
                if t: triggers.append(t)
                for tag in (sel.get("tags") or "").split(","):
                    tag = tag.strip()
                    if tag and tag not in seen:
                        all_tags.append(tag); seen.add(tag)
            return (", ".join(triggers), ", ".join(all_tags))
        except Exception as e:
            print(f"[AnimaDex] 角色选择出错: {e}")
            return ("", "")


# ============================================================
# 画师画廊节点
# ============================================================

class AnimaDexArtistGallery:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "selection_data": ("STRING", {"default": "{}", "multiline": True, "forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("trigger",)
    FUNCTION = "get_selected_data"
    CATEGORY = "AnimaDex"
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, selection_data="{}", **kwargs):
        return selection_data

    def get_selected_data(self, selection_data="{}", **kwargs):
        if not selection_data or selection_data == "{}":
            return ("",)
        try:
            data = json.loads(selection_data)
            selections = data.get("selections", [])
            if not selections:
                return ("",)
            artists = []
            for sel in selections:
                name = (sel.get("trigger") or sel.get("name") or "").strip()
                # 转义括号，和 animadex.net 网页显示一致
                name = name.replace("(", "\\(").replace(")", "\\)")
                if name: artists.append(f"@{name}")
            return ("，".join(artists),)
        except Exception as e:
            print(f"[AnimaDex] 画师选择出错: {e}")
            return ("",)


# ============================================================
# API 路由
# ============================================================

@PromptServer.instance.routes.get("/animadex/characters/search")
async def api_characters_search(request):
    try:
        data = _animadex_fetch("characters", {
            "q": request.query.get("q"),
            "page": request.query.get("page", "1"),
            "page_size": request.query.get("page_size", str(PAGE_SIZE)),
            "sort": request.query.get("sort", "count"),
            "copyright": request.query.get("copyright"),
        })
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"error": str(e), "results": [], "total": 0, "pages": 0}, status=500)


@PromptServer.instance.routes.get("/animadex/characters/facets")
async def api_characters_facets(request):
    try:
        return web.json_response(_animadex_facets("characters"))
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/animadex/artists/search")
async def api_artists_search(request):
    try:
        data = _animadex_fetch("artists", {
            "q": request.query.get("q"),
            "page": request.query.get("page", "1"),
            "page_size": request.query.get("page_size", str(PAGE_SIZE)),
            "sort": request.query.get("sort", "count"),
            "score": request.query.get("score"),
        })
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"error": str(e), "results": [], "total": 0, "pages": 0}, status=500)


@PromptServer.instance.routes.get("/animadex/artists/facets")
async def api_artists_facets(request):
    try:
        return web.json_response(_animadex_facets("artists"))
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/animadex/proxy_image")
async def api_proxy_image(request):
    url = request.query.get("url", "")
    if not url: return web.Response(status=400)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as resp:
            img_bytes = resp.read()
        ct = "image/webp"
        if url.endswith(".png"): ct = "image/png"
        elif url.endswith(".jpg") or url.endswith(".jpeg"): ct = "image/jpeg"
        return web.Response(body=img_bytes, content_type=ct)
    except Exception:
        return web.Response(status=404)


@PromptServer.instance.routes.get("/animadex/batch_images")
async def api_batch_images(request):
    """批量加载图片，返回 base64 data URI"""
    urls = request.query.getall("url", [])
    if not urls:
        return web.json_response({})
    result = {}
    for url in urls[:36]:  # 最多36张
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=10) as resp:
                img_bytes = resp.read()
            import base64
            ct = "image/webp"
            if url.endswith(".png"): ct = "image/png"
            elif url.endswith(".jpg") or url.endswith(".jpeg"): ct = "image/jpeg"
            b64 = base64.b64encode(img_bytes).decode()
            result[url] = f"data:{ct};base64,{b64}"
        except Exception:
            result[url] = ""
    return web.json_response(result)


# ============================================================
# 收藏夹 API
# ============================================================

@PromptServer.instance.routes.get("/animadex/favorites")
async def api_favorites_list(request):
    return web.json_response(_favorites)


@PromptServer.instance.routes.post("/animadex/favorites/toggle")
async def api_favorites_toggle(request):
    try:
        body = await request.json()
        mode = body.get("mode", "characters")
        slug = body.get("slug", "")
        if not slug or mode not in ("characters", "artists"):
            return web.json_response({"success": False})
        favs = _favorites[mode]
        if slug in favs:
            favs.remove(slug); added = False
        else:
            favs.append(slug); added = True
        _persist_favorites()
        return web.json_response({"success": True, "added": added})
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)})


@PromptServer.instance.routes.get("/animadex/favorites/search")
async def api_favorites_search(request):
    mode = request.query.get("mode", "characters")
    if mode not in ("characters", "artists"):
        return web.json_response({"results": [], "total": 0})
    slugs = _favorites.get(mode, [])
    if not slugs:
        return web.json_response({"results": [], "total": 0})

    results, seen = [], set()
    with _cache_lock:
        for key, (data, ts) in list(_mem_cache.items()):
            if time.time() - ts >= CACHE_TTL: continue
            if not key.startswith(f"{mode}|"): continue
            for item in data.get("results", []):
                s = item.get("slug")
                if s in slugs and s not in seen:
                    results.append(item); seen.add(s)

    for slug in slugs:
        if slug not in seen:
            try:
                data = _animadex_fetch(mode, {"q": slug, "page_size": "1"})
                for item in data.get("results", []):
                    if item.get("slug") == slug:
                        results.append(item); break
            except Exception:
                pass
    return web.json_response({"results": results, "total": len(results)})


NODE_CLASS_MAPPINGS = {
    "AnimaDexCharacterGallery": AnimaDexCharacterGallery,
    "AnimaDexArtistGallery": AnimaDexArtistGallery,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimaDexCharacterGallery": "🎭 AnimaDex 角色画廊 (Character Gallery)",
    "AnimaDexArtistGallery": "🎨 AnimaDex 画师画廊 (Artist Gallery)",
}
