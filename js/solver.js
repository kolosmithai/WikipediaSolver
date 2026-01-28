/**
 * Solver Logic using Bidirectional BFS
 * Features:
 * 1. Strict Traditional Chinese (zh-tw) normalization for all nodes.
 * 2. Mobile-format parsing to exclude Navboxes/Templates (Phantom links).
 * 3. Path Verification to ensure Backlink candidates actually exist in body text.
 */

const API_BASE = 'https://zh.wikipedia.org/w/api.php';

class PathSolver {
    constructor() {
        this.cache = {}; // Cache for page content/links
        this.isRunning = false;
        this.MAX_TITLES_PER_QUERY = 50;
    }

    async run(start, target, updateCallback) {
        this.isRunning = true;
        this.updateCallback = updateCallback;
        const startTime = Date.now();

        // 1. Normalize Titles (Strict zh-tw)
        updateCallback(0.1, '正在標準化標題...');
        const [startNorm, targetNorm] = await Promise.all([
            this.normalizeTitle(start),
            this.normalizeTitle(target)
        ]);

        if (!startNorm || !targetNorm) throw new Error('無效的起點或終點主題。');
        if (startNorm === targetNorm) return { path: [startNorm], time: 0 };

        // 2. Bidirectional BFS
        const visitedForward = new Map(); // Node -> Parent
        visitedForward.set(startNorm, null);

        const visitedBackward = new Map(); // Node -> Child (The node that links TO this node)
        visitedBackward.set(targetNorm, null);

        let queueForward = [startNorm];
        let queueBackward = [targetNorm];

        let depth = 0;
        const MAX_DEPTH = 6;

        while (this.isRunning && queueForward.length > 0 && queueBackward.length > 0 && depth < MAX_DEPTH) {
            depth++;
            updateCallback(0.2 + (depth * 0.1), `正在搜尋深度 ${depth}... (佇列: ${queueForward.length} / ${queueBackward.length})`);

            // --- Expand Forward ---
            const nextQueueForward = [];
            for (const current of queueForward) {
                if (!this.isRunning) return;

                const links = await this.getForwardLinks(current);

                for (const link of links) {
                    // Check intersection
                    if (visitedBackward.has(link)) {
                        const path = this.reconstructPath(visitedForward, visitedBackward, current, link);
                        // VERIFY PATH VALIDITY (Filter out Navbox/Backlink ghosts)
                        const isValid = await this.verifyPath(path);
                        if (isValid) {
                            return { path, time: Date.now() - startTime };
                        } else {
                            console.warn('Path verification failed (ghost link):', path);
                            continue; // Skip this match, keep searching
                        }
                    }

                    if (!visitedForward.has(link)) {
                        visitedForward.set(link, current);
                        nextQueueForward.push(link);
                    }
                }
            }
            queueForward = nextQueueForward;

            // --- Expand Backward ---
            const nextQueueBackward = [];
            for (const current of queueBackward) {
                if (!this.isRunning) return;

                // Backlinks are "dirty" (include templates). Normalization is less critical here 
                // as we rely on Forward search to verify connectivity eventually.
                const backlinks = await this.getBackLinks(current);

                for (const bl of backlinks) {
                    // Check intersection
                    if (visitedForward.has(bl)) {
                        const path = this.reconstructPath(visitedForward, visitedBackward, bl, current);
                        // VERIFY PATH VALIDITY
                        const isValid = await this.verifyPath(path);
                        if (isValid) {
                            return { path, time: Date.now() - startTime };
                        } else {
                            console.warn('Path verification failed (ghost link):', path);
                            continue;
                        }
                    }

                    if (!visitedBackward.has(bl)) {
                        visitedBackward.set(bl, current); // bl links TO current
                        nextQueueBackward.push(bl);
                    }
                }
            }
            queueBackward = nextQueueBackward;
        }

        throw new Error('達到搜尋深度限制，未找到路徑。');
    }

    reconstructPath(forwardMap, backwardMap, meetPoint, backwardMeetPoint) {
        // Forward part: Start -> ... -> meetPoint
        const pathStart = [];
        let curr = meetPoint;
        while (curr) {
            pathStart.push(curr);
            curr = forwardMap.get(curr);
        }
        pathStart.reverse();

        // Backward part: backwardMeetPoint -> ... -> Target
        // visitedBackward maps Node -> Child. 
        // Logic: backwardMeetPoint links TO visitedBackward.get(backwardMeetPoint)
        const pathEnd = [];
        curr = backwardMeetPoint;
        while (curr) {
            pathEnd.push(curr);
            curr = backwardMap.get(curr); // This gets the node that 'curr' links to
        }

        // Note: verify intersection logic
        // Forward: A -> meetPoint
        // Backward: backwardMeetPoint -> B (Where backwardMeetPoint IS linked from B?)
        // Wait, backwardMap logic:
        // visitedBackward.set(startNode, null) -> Target
        // visitedBackward.set(bl, current) -> bl links TO current
        // So path is: bl -> current -> ... -> Target

        // If intersection is 'link' (found in Forward search) matching 'visitedBackward'
        // 'link' is 'backwardMeetPoint' (the start of the backward chain)
        // 'current' (Forward) links TO 'link'.
        // So path is ...current -> link -> ...

        // My Logic in BFS:
        // Forward Loop: current -> link. If backward.has(link)...
        // Path: (Start...current) + (link...Target)
        // reconstructPath(..., current, link)

        // Backward Loop: current (Target-side parent) <- bl. If forward.has(bl)...
        // Path: (Start...bl) + (current...Target)
        // reconstructPath(..., bl, current)

        // Check implementation:
        // pathStart includes meetPoint.
        // pathEnd includes backwardMeetPoint.
        // In Forward Loop: meetPoint=current, backwardMeetPoint=link.
        // pathStart ends with 'current'.
        // pathEnd starts with 'link'.
        // Result: [...pathStart, ...pathEnd]. Correct.

        return [...pathStart, ...pathEnd];
    }

    // Verify that every step A->B exists in the body text (Clean)
    async verifyPath(path) {
        for (let i = 0; i < path.length - 1; i++) {
            const A = path[i];
            const B = path[i + 1];
            // We use getForwardLinks(A) which is cached and uses Mobile Format (Clean)
            const links = await this.getForwardLinks(A);
            if (!links.includes(B)) {
                // Double check normalization just in case?
                // getForwardLinks now returns Normalized titles.
                // So strict check should suffice.
                return false;
            }
        }
        return true;
    }

    async normalizeTitle(title) {
        const params = new URLSearchParams({
            action: 'query',
            titles: title,
            redirects: 1,
            converttitles: 1,
            variant: 'zh-tw',
            format: 'json',
            origin: '*'
        });

        try {
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            const pages = data.query.pages;
            const pageId = Object.keys(pages)[0];
            if (pageId === '-1') return null;
            return pages[pageId].title;
        } catch (e) { return null; }
    }

    async getForwardLinks(title) {
        if (this.cache[title]?.links) return this.cache[title].links;

        // 1. Parse HTML to find body links
        const params = new URLSearchParams({
            action: 'parse',
            page: title,
            prop: 'text',
            mobileformat: true, // Hides Navboxes/Sidebar
            variant: 'zh-tw',   // Request converted text
            format: 'json',
            origin: '*',
            redirects: 1
        });

        try {
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();

            if (data.error) return [];

            const html = data.parse.text['*'];
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // Extract HREFs
            const anchors = doc.querySelectorAll('a[href^="/wiki/"]');
            const rawTitles = new Set();

            for (const a of anchors) {
                const href = a.getAttribute('href');
                let linkTitle = decodeURIComponent(href.replace('/wiki/', ''));
                if (linkTitle.includes(':') || linkTitle.includes('#')) continue;
                linkTitle = linkTitle.replace(/_/g, ' ');
                rawTitles.add(linkTitle);
            }

            // 2. Batch Normalize Titles to zh-tw
            // This is critical to match the Graph nodes
            const uniqueTitles = Array.from(rawTitles);

            // Chunking
            const normalizedLinks = [];
            for (let i = 0; i < uniqueTitles.length; i += this.MAX_TITLES_PER_QUERY) {
                const chunk = uniqueTitles.slice(i, i + this.MAX_TITLES_PER_QUERY);
                const normChunk = await this.batchNormalize(chunk);
                normalizedLinks.push(...normChunk);
            }

            // Cache result
            this.cache[title] = { links: normalizedLinks };
            return normalizedLinks;

        } catch (e) {
            console.error('Forward Links Error:', e);
            return [];
        }
    }

    async batchNormalize(titles) {
        if (titles.length === 0) return [];

        const params = new URLSearchParams({
            action: 'query',
            titles: titles.join('|'),
            redirects: 1,
            converttitles: 1,
            variant: 'zh-tw',
            format: 'json',
            origin: '*'
        });

        try {
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();

            // We want a list of Resolved Titles
            // query.pages contains the map.
            // We can iterate pages and extract 'title'.
            // Note: If a title is invalid, it might be missing or have 'missing'.

            const results = [];
            const pages = data.query.pages || {};

            Object.values(pages).forEach(p => {
                if (!p.missing && p.title) {
                    results.push(p.title);
                }
            });

            return results;
        } catch (e) {
            return titles; // Fallback
        }
    }

    async getBackLinks(title) {
        const params = new URLSearchParams({
            action: 'query',
            list: 'backlinks',
            bltitle: title,
            blnamespace: 0,
            blhalflimit: 50,
            variant: 'zh-tw',
            format: 'json',
            origin: '*'
        });

        try {
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            return data.query.backlinks.map(b => b.title);
        } catch (e) {
            return [];
        }
    }
}

// UI Controller
const solverApp = {
    solver: new PathSolver(),

    async run() {
        const start = document.getElementById('start-input').value;
        const target = document.getElementById('target-input').value;
        const btn = document.getElementById('btn-solve');
        const progressArea = document.getElementById('progress-area');
        const fill = document.getElementById('progress-element');
        const status = document.getElementById('status-text');
        const resultArea = document.getElementById('result-area');

        if (!start || !target) return alert('請輸入起點與終點主題');

        btn.disabled = true;
        btn.textContent = '解題中...';
        progressArea.style.display = 'block';
        resultArea.style.display = 'none';
        fill.style.width = '5%';
        status.textContent = '初始化中...';

        try {
            const result = await this.solver.run(start, target, (progress, msg) => {
                fill.style.width = `${Math.min(progress * 100, 95)}%`;
                status.textContent = msg;
            });

            // Even with robust logic, one final visual polish via Wikilinks 
            // to ensure absolute correct terminology (e.g. 智慧型手機)
            status.textContent = '正在優化顯示...';
            const convertedPath = await this.convertPathToTC(result.path);
            result.path = convertedPath;

            fill.style.width = '100%';
            status.textContent = '完成！';
            this.showResult(result);

        } catch (e) {
            console.error(e);
            alert('搜尋失敗: ' + e.message);
            status.textContent = '失敗: ' + e.message;
        } finally {
            btn.disabled = false;
            btn.textContent = '開始解題';
        }
    },

    async convertPathToTC(path) {
        if (!path || path.length === 0) return path;
        try {
            const separator = '|||';
            const textToConvert = path.map(p => `[[${p}]]`).join(separator);

            const params = new URLSearchParams({
                action: 'parse',
                text: textToConvert,
                prop: 'text',
                variant: 'zh-tw',
                format: 'json',
                origin: '*',
                disablelimitreport: 1,
                contentmodel: 'wikitext'
            });

            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();

            if (data.parse && data.parse.text) {
                const doc = new DOMParser().parseFromString(data.parse.text['*'], 'text/html');
                const rawText = doc.body.textContent || "";
                let convertedItems = rawText.split(separator).map(s => s.trim());

                if (convertedItems.length === path.length) {
                    return convertedItems;
                }
            }
            return path;
        } catch (e) {
            return path;
        }
    },

    showResult(result) {
        const list = document.getElementById('path-list');
        const area = document.getElementById('result-area');
        const timeEl = document.getElementById('time-taken');
        const socialText = document.getElementById('social-text');

        area.style.display = 'block';
        timeEl.textContent = `(${(result.time / 1000).toFixed(2)}秒)`;

        list.innerHTML = result.path.map((item, i) => `
            <div class="path-item">
                <div class="path-index">${i + 1}</div>
                <div class="path-content">${item}</div>
                ${i === 0 ? '<div class="path-tag">起點</div>' : ''}
                ${i === result.path.length - 1 ? '<div class="path-tag">終點</div>' : ''}
            </div>
        `).join('');

        const arrows = result.path.join(' → ');
        const text = `🏆 昨日最速路徑公告 🏆\n\n昨日題目：${result.path[0]} → ${result.path[result.path.length - 1]}\n最佳步數：${result.path.length - 1} 步\n\n參考路徑：\n${arrows}\n\n#WikiGame #DailyChallenge`;

        socialText.textContent = text;
    },

    copySocial() {
        const text = document.getElementById('social-text').textContent;
        navigator.clipboard.writeText(text).then(() => alert('已複製！'));
    }
};

window.solverApp = solverApp;
