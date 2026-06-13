"""
ComfyUI-AnimaDex-Gallery
========================
实时从 https://animadex.net 获取数据的 ComfyUI 画廊插件。

节点:
  - AnimaDexCharacterGallery: 角色画廊 → 勾选即输出 trigger + tags
  - AnimaDexArtistGallery:    画师画廊 → 勾选即输出 trigger（@前缀,，分隔）

特性: 实时在线 + 本地缓存(1h TTL) + 收藏夹
"""

from .py.animadex_gallery import (
    NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS,
)

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[AnimaDex] 插件已加载 — 角色画廊 + 画师画廊")
