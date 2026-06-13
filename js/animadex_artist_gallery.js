/**
 * AnimaDex 画师画廊 — 前端面板
 * 每页9条 / 图片contain / 窗口自适应 / 勾选即输出 / 收藏夹 / 缓存
 */
import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";

app.registerExtension({
    name: "Comfy.AnimaDexArtistGallery",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "AnimaDexArtistGallery") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;
            const MIN_W = 370, MIN_H = 520;

            // 网格布局: {cols, rows, pageSize}
            const LAYOUTS = {
                "1×2":  { cols: 1, rows: 2, pageSize: 2,  w: 200, h: 520 },
                "2×1":  { cols: 2, rows: 1, pageSize: 2,  w: 370, h: 350 },
                "2×2":  { cols: 2, rows: 2, pageSize: 4,  w: 370, h: 520 },
                "2×3":  { cols: 2, rows: 3, pageSize: 6,  w: 370, h: 720 },
                "3×2":  { cols: 3, rows: 2, pageSize: 6,  w: 520, h: 520 },
                "3×3":  { cols: 3, rows: 3, pageSize: 9,  w: 550, h: 750 },
            };
            let gridLayout = "3×3";

            function applyLayout() {
                const L = LAYOUTS[gridLayout];
                grid.style.gridTemplateColumns = `repeat(${L.cols}, 1fr)`;
                node.setSize([Math.max(MIN_W, L.w), Math.max(MIN_H, L.h)]);
            }

            // 强制最小尺寸
            const _onResize = node.onResize;
            node.onResize = function(size) {
                size[0] = Math.max(MIN_W, size[0]);
                size[1] = Math.max(MIN_H, size[1]);
                if (_onResize) _onResize.call(this, size);
            };

            let items = [], currentPage = 1, totalPages = 1, totalCount = 0;
            let isLoading = false, selectedSlugs = new Set(), favoriteSlugs = new Set();
            let searchQuery = "", scoreFilter = "", showFavoritesOnly = false;

            const selWidget = node.addWidget("text", "selection_data", "{}", () => {}, { serialize: true });
            selWidget.computeSize = () => [0, -4]; selWidget.type = "hidden";

            function pushSelection() {
                const selections = [];
                for (const slug of selectedSlugs) {
                    const item = items.find(i => i.slug === slug);
                    if (item) selections.push({ slug, trigger: item.trigger || "", name: item.name || "" });
                }
                selWidget.value = JSON.stringify({ selections });
                try { node.onWidgetChanged?.(selWidget); } catch(e) {}
                try { app.graph?.setDirtyCanvas(true, true); } catch(e) {}
            }

            const container = $el("div.animadex-artgallery", {
                style: {
                    width: "100%", height: "100%", display: "flex", flexDirection: "column",
                    padding: "36px 6px 6px 6px", boxSizing: "border-box",
                    fontFamily: "sans-serif", fontSize: "13px", color: "#ccc", background: "#1a1a1a",
                    overflow: "hidden"
                }
            });

            // ---- 样式工厂（必须在引用前定义） ----
            const S = {
                input: () => ({ flex: "1", padding: "5px 8px", borderRadius: "4px", border: "1px solid #444", background: "#2a2a2a", color: "#fff", fontSize: "13px", outline: "none" }),
                icon: () => ({ padding: "5px 10px", borderRadius: "4px", cursor: "pointer", border: "1px solid #555", background: "#333", color: "#ccc", fontSize: "12px" }),
                small: (c) => ({ padding: c ? "4px 8px" : "4px 10px", borderRadius: "4px", cursor: "pointer", border: "1px solid #444", background: "#2a2a2a", color: "#aaa", fontSize: "11px" }),
                select: () => ({ padding: "5px 6px", borderRadius: "4px", border: "1px solid #444", background: "#2a2a2a", color: "#ccc", fontSize: "12px", maxWidth: "160px" }),
            };

            // ---- 顶栏 ----
            const topBar = $el("div", { style: { display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", flexShrink: "0" } });
            topBar.appendChild($el("div", { textContent: "🎨 画师", style: { fontSize: "14px", fontWeight: "bold", color: "#e8a840" } }));
            const favToggle = $el("button", { textContent: "⭐ 收藏", style: S.small(), onclick: () => {
                showFavoritesOnly = !showFavoritesOnly;
                favToggle.style.background = showFavoritesOnly ? "#3a3a00" : "#2a2a2a";
                favToggle.style.borderColor = showFavoritesOnly ? "#c90" : "#444";
                currentPage = 1;
                showFavoritesOnly ? fetchFavorites() : (searchQuery = "", searchInput.value = "", scoreFilter = "", scoreSelect.value = "", fetchItems());
            }});
            topBar.appendChild(favToggle);
            topBar.appendChild($el("button", { textContent: "🔄", style: S.small(), title: "强制刷新", onclick: () => fetchItems(true) }));
            // 布局选择
            const layoutSelect = $el("select", { style: { ...S.small(), fontSize: "10px", maxWidth: "56px", padding: "3px 4px" } });
            Object.keys(LAYOUTS).forEach(k => layoutSelect.appendChild($el("option", { value: k, textContent: k })));
            layoutSelect.value = gridLayout;
            layoutSelect.addEventListener("change", () => {
                gridLayout = layoutSelect.value;
                applyLayout();
                currentPage = 1;
                fetchItems();
            });
            topBar.appendChild(layoutSelect);
            topBar.appendChild($el("button", { textContent: "🗑 清除", style: S.small(), title: "清除所有选择", onclick: () => {
                selectedSlugs.clear();
                outputPreview.style.display = "none";
                renderGrid();
                try { pushSelection(); } catch(e) {}
            }}));
            container.appendChild(topBar);

            // ---- 输出预览 ----
            const outputPreview = $el("div", {
                style: { display: "none", padding: "4px 6px", marginBottom: "4px", borderRadius: "4px",
                    background: "#2a2a1a", border: "1px solid #e8a84055", fontSize: "11px",
                    color: "#e8a840", wordBreak: "break-all", lineHeight: "1.4", flexShrink: "0" }
            });
            container.appendChild(outputPreview);

            // ---- 搜索栏 ----
            const searchBar = $el("div", { style: { display: "flex", gap: "4px", marginBottom: "4px", flexShrink: "0" } });
            const searchInput = $el("input", { type: "text", placeholder: "搜索...", style: S.input() });
            searchInput.addEventListener("keydown", e => { if (e.key === "Enter") { searchQuery = searchInput.value.trim(); currentPage = 1; fetchItems(); } });
            searchBar.appendChild(searchInput);
            searchBar.appendChild($el("button", { textContent: "🔍", style: S.icon(), onclick: () => { searchQuery = searchInput.value.trim(); currentPage = 1; fetchItems(); } }));
            const scoreSelect = $el("select", { style: S.select() });
            [["", "全部评分"],["5","⭐⭐⭐⭐⭐ 50%+"],["4","⭐⭐⭐⭐ 40-50%"],["3","⭐⭐⭐ 30-40%"],["2","⭐⭐ 20-30%"],["1","⭐ <20%"]].forEach(([v,l]) => scoreSelect.appendChild($el("option",{value:v,textContent:l})));
            scoreSelect.addEventListener("change", () => { scoreFilter = scoreSelect.value; currentPage = 1; fetchItems(); });
            searchBar.appendChild(scoreSelect);
            container.appendChild(searchBar);

            // ---- 信息栏 ----
            const infoBar = $el("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "11px", color: "#777", flexShrink: "0" } });
            const infoText = $el("span"), pageInfo = $el("span");
            infoBar.appendChild(infoText); infoBar.appendChild(pageInfo);
            container.appendChild(infoBar);

            // ---- 网格 ----
            const grid = $el("div", {
                style: { flex: "1", overflowY: "auto", minHeight: "0",
                    display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "4px", alignContent: "start", padding: "2px" }
            });
            container.appendChild(grid);

            // ---- 分页 ----
            const pagination = $el("div", { style: { display: "flex", justifyContent: "center", gap: "4px", marginTop: "4px", alignItems: "center", flexShrink: "0" } });
            const prevBtn = $el("button", { textContent: "◀", style: S.small(true), onclick: () => { if (currentPage > 1) { currentPage--; fetchItems(); } } });
            const pageNum = $el("span", { textContent: "", style: { color: "#888", fontSize: "11px" } });
            const nextBtn = $el("button", { textContent: "▶", style: S.small(true), onclick: () => { if (currentPage < totalPages) { currentPage++; fetchItems(); } } });
            pagination.appendChild(prevBtn); pagination.appendChild(pageNum); pagination.appendChild(nextBtn);
            container.appendChild(pagination);

            node.addDOMWidget("animadex_artgallery", "div", container, { onDraw: () => {} });

            async function loadFavorites() {
                try { const r = await fetch("/animadex/favorites"); favoriteSlugs = new Set((await r.json()).artists || []); } catch (e) {}
            }
            async function fetchItems(force = false) {
                if (showFavoritesOnly) { fetchFavorites(); return; }
                if (isLoading) return;
                isLoading = true;
                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#666">加载中...</div>';
                const L = LAYOUTS[gridLayout];
                const p = new URLSearchParams({ page: currentPage, sort: "count", page_size: L.pageSize });
                if (searchQuery) p.set("q", searchQuery);
                if (scoreFilter) p.set("score", scoreFilter);
                if (force) p.set("_t", Date.now());
                try {
                    const r = await fetch(`/animadex/artists/search?${p}`);
                    const d = await r.json();
                    items = d.results || []; totalPages = d.pages || 1; totalCount = d.total || 0;
                    infoText.textContent = `共 ${totalCount.toLocaleString()} 位画师`;
                    pageNum.textContent = `${currentPage} / ${totalPages}`;
                    prevBtn.disabled = currentPage <= 1; nextBtn.disabled = currentPage >= totalPages;
                    updatePreview(); renderGrid();
                } catch (e) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#c44">⚠ 网络错误</div>'; }
                isLoading = false;
            }
            async function fetchFavorites() {
                isLoading = true;
                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#666">加载收藏...</div>';
                try {
                    const r = await fetch(`/animadex/favorites/search?mode=artists&_=${Date.now()}`);
                    const d = await r.json();
                    items = d.results || []; totalPages = 1; totalCount = items.length;
                    infoText.textContent = `⭐ 收藏: ${totalCount}`; pageNum.textContent = "";
                    prevBtn.disabled = nextBtn.disabled = true;
                    updatePreview(); renderGrid();
                } catch (e) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#c44">⚠ 加载失败</div>'; }
                isLoading = false;
            }
            function updatePreview() {
                const sel = items.filter(i => selectedSlugs.has(i.slug));
                if (sel.length) {
                    outputPreview.style.display = "block";
                    outputPreview.innerHTML = "👉 " + sel.map(s => "@" + (s.trigger || s.name)).join("<br>👉 ");
                } else {
                    outputPreview.style.display = "none";
                }
            }
            function renderGrid() {
                grid.innerHTML = "";
                if (!items.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#666">无结果</div>'; return; }
                items.forEach(i => grid.appendChild(createCard(i)));
            }
            function createCard(item) {
                const slug = item.slug, name = item.name || slug, trigger = item.trigger || "", count = item.count || 0;
                const score = item.score != null ? item.score : 0, pct = Math.round(score * 100);
                const stars = pct >= 50 ? "★★★★★" : pct >= 40 ? "★★★★" : pct >= 30 ? "★★★" : pct >= 20 ? "★★" : "★";
                const imgUrl = item.thumb_url ? `/animadex/proxy_image?url=${encodeURIComponent(item.thumb_url)}` : "";
                const isFav = favoriteSlugs.has(slug), isSel = selectedSlugs.has(slug);

                const card = $el("div", {
                    style: { border: isSel ? "2px solid #4a9eff" : "1px solid #333", borderRadius: "5px", overflow: "hidden", background: "#222", cursor: "pointer", position: "relative", transition: "border-color 0.15s" }
                });
                const check = $el("div", {
                    style: { position: "absolute", top: "3px", left: "3px", zIndex: "2", width: "18px", height: "18px", borderRadius: "3px", background: isSel ? "#4a9eff" : "rgba(0,0,0,0.4)", border: "2px solid " + (isSel ? "#4a9eff" : "#666"), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#fff", fontWeight: "bold" },
                    textContent: isSel ? "✓" : ""
                }); card.appendChild(check);
                const star = $el("div", {
                    style: { position: "absolute", top: "3px", right: "3px", zIndex: "2", fontSize: "14px", cursor: "pointer", color: isFav ? "#fc0" : "#555", textShadow: "0 0 3px rgba(0,0,0,0.8)", lineHeight: "1" },
                    textContent: isFav ? "★" : "☆", title: isFav ? "取消收藏" : "收藏"
                });
                star.addEventListener("click", e => { e.stopPropagation(); toggleFav("artists", slug, star); });
                card.appendChild(star);
                card.addEventListener("click", () => {
                    if (selectedSlugs.has(slug)) { selectedSlugs.delete(slug); card.style.borderColor = "#333"; check.style.background = "rgba(0,0,0,0.4)"; check.style.borderColor = "#666"; check.textContent = ""; }
                    else { selectedSlugs.add(slug); card.style.borderColor = "#4a9eff"; check.style.background = "#4a9eff"; check.style.borderColor = "#4a9eff"; check.textContent = "✓"; }
                    updatePreview(); pushSelection();
                });
                if (imgUrl) {
                    const img = $el("img", { src: imgUrl, loading: "lazy", style: { width: "100%", aspectRatio: "3/4", objectFit: "contain", display: "block", background: "#1a1a1a" } });
                    img.onerror = () => { img.style.display = "none"; };
                    card.appendChild(img);
                }
                const info = $el("div", { style: { padding: "4px 6px", minHeight: "40px" } });
                info.appendChild($el("div", { textContent: name, style: { fontSize: "12px", fontWeight: "bold", color: "#ddd", wordBreak: "break-all", lineHeight: "1.3" } }));
                info.appendChild($el("div", { textContent: trigger, style: { fontSize: "10px", color: "#aaa", marginTop: "3px", wordBreak: "break-all", lineHeight: "1.3" } }));
                info.appendChild($el("div", { textContent: `${stars} ${pct}%`, style: { fontSize: "10px", color: "#c90", marginTop: "3px" } }));
                info.appendChild($el("div", { textContent: `📊 ${count.toLocaleString()}`, style: { fontSize: "10px", color: "#555", marginTop: "3px" } }));
                card.appendChild(info);
                return card;
            }
            async function toggleFav(mode, slug, el) {
                try {
                    const r = await fetch("/animadex/favorites/toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, slug }) });
                    const d = await r.json();
                    if (d.success) {
                        if (d.added) { favoriteSlugs.add(slug); if (el) { el.textContent = "★"; el.style.color = "#fc0"; el.title = "取消收藏"; } }
                        else { favoriteSlugs.delete(slug); if (el) { el.textContent = "☆"; el.style.color = "#555"; el.title = "收藏"; } }
                        if (showFavoritesOnly && !d.added) fetchFavorites();
                    }
                } catch (e) {}
            }
            applyLayout();
            loadFavorites().then(() => fetchItems());
        };
    }
});
