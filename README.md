# ComfyUI-AnimaDex-Gallery

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ComfyUI 自定义节点插件，从 [animadex.net](https://animadex.net) 实时获取角色和画师数据，提供画廊式浏览器界面。

## 节点

| 节点 | 功能 | 输出 |
|------|------|------|
| 🎭 AnimaDex 角色画廊 | 浏览/搜索角色，按版权过滤 | `trigger` + `tags` (STRING) |
| 🎨 AnimaDex 画师画廊 | 浏览/搜索画师，按评分过滤 | `trigger` (STRING, @前缀) |

## 特性

- **实时在线** — 每次请求直接从 animadex.net API 拉取，不做本地预缓存
- **智能缓存** — 内存缓存 1 小时 TTL，自动持久化到磁盘，重启不丢失
- **收藏夹** — ⭐ 收藏角色/画师，一键切换收藏视图
- **布局切换** — 6 种网格布局：1×2 ~ 3×3
- **括号转义** — 输出 trigger 自动转义 `()` → `\(\)`，与网页复制一致
- **画师格式** — 自动添加 `@` 前缀，多选用 `，` 分隔

## 安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/yudachi0220/ComfyUI-AnimaDex-Gallery.git
```

重启 ComfyUI。

## 依赖

无额外依赖，仅使用 Python 标准库。

## 使用

1. 在节点列表 `AnimaDex` 分类下找到「角色画廊」或「画师画廊」
2. 拖入画布，等待加载（首次从网络获取，后续命中缓存即时显示）
3. 搜索/筛选 → 点击卡片勾选 → 自动输出到下游节点
4. 使用 `⭐` 收藏常用项，点击顶栏「⭐ 收藏」切换收藏视图

### 角色画廊

- 搜索角色名称
- 版权下拉过滤（3700+ 系列）
- 勾选后输出 `trigger` 和 `tags`

### 画师画廊

- 搜索画师名称
- 评分过滤（⭐ ~ ⭐⭐⭐⭐⭐）
- 勾选后输出 `@画师名`，多个用 `，` 连接

## API

数据来源：[animadex.net](https://animadex.net) — ANIMA AI 模型的角色与画师目录

## License

MIT
