
import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';

const API_BASE = 'https://zh.wikipedia.org/w/api.php';

export class PathSolver {
    constructor() {
        this.cache = {}; // Cache for page content/links
        this.isRunning = false;
        this.MAX_TITLES_PER_QUERY = 50;
    }

    async run(start, target, updateCallback = () => { }) {
        this.isRunning = true;

        console.log(`Starting solver: ${start} -> ${target}`);

        // 1. Normalize Titles (Strict zh-tw)
        updateCallback(0.1, '正在標準化標題...');
        const [startNorm, targetNorm] = await Promise.all([
            this.normalizeTitle(start),
            this.normalizeTitle(target)
        ]);

        if (!startNorm || !targetNorm) throw new Error(`無效的起點 (${start}) 或終點 (${target}) 主題。`);
        console.log(`Normalized: ${startNorm} -> ${targetNorm}`);

        if (startNorm === targetNorm) return { path: [startNorm], time: 0 };

        // 2. Bidirectional BFS
        const visitedForward = new Map(); // Node -> Parent
        visitedForward.set(startNorm, null);

        const visitedBackward = new Map(); // Node -> Child
        visitedBackward.set(targetNorm, null);

        let queueForward = [startNorm];
        let queueBackward = [targetNorm];

        let depth = 0;
        const MAX_DEPTH = 6;
        const startTime = Date.now();

        while (this.isRunning && queueForward.length > 0 && queueBackward.length > 0 && depth < MAX_DEPTH) {
            depth++;
            updateCallback(0.2 + (depth * 0.1), `正在搜尋深度 ${depth}... (佇列: ${queueForward.length} / ${queueBackward.length})`);
            console.log(`Depth ${depth}: ${queueForward.length} forward, ${queueBackward.length} backward`);

            // --- Expand Forward ---
            const nextQueueForward = [];
            for (const current of queueForward) {
                if (!this.isRunning) return;

                const links = await this.getForwardLinks(current);

                for (const link of links) {
                    // Check intersection
                    if (visitedBackward.has(link)) {
                        const path = this.reconstructPath(visitedForward, visitedBackward, current, link);
                        // VERIFY PATH VALIDITY
                        const isValid = await this.verifyPath(path);
                        if (isValid) {
                            return { path, time: Date.now() - startTime };
                        } else {
                            continue;
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
        const pathEnd = [];
        curr = backwardMeetPoint;
        while (curr) {
            pathEnd.push(curr);
            curr = backwardMap.get(curr);
        }

        return [...pathStart, ...pathEnd];
    }

    async verifyPath(path) {
        for (let i = 0; i < path.length - 1; i++) {
            const A = path[i];
            const B = path[i + 1];
            const links = await this.getForwardLinks(A);
            if (!links.includes(B)) {
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
            const res = await fetch(`${API_BASE}?${params}`, {
                headers: { 'User-Agent': 'WikiSolverBot/1.0 (mailto:example@example.com)' }
            });
            const data = await res.json();
            const pages = data.query.pages;
            const pageId = Object.keys(pages)[0];
            if (pageId === '-1') return null;
            return pages[pageId].title;
        } catch (e) { return null; }
    }

    async getForwardLinks(title) {
        if (this.cache[title]?.links) return this.cache[title].links;

        const params = new URLSearchParams({
            action: 'parse',
            page: title,
            prop: 'text',
            mobileformat: true,
            variant: 'zh-tw',
            format: 'json',
            origin: '*',
            redirects: 1
        });

        try {
            const res = await fetch(`${API_BASE}?${params}`, {
                headers: { 'User-Agent': 'WikiSolverBot/1.0 (mailto:example@example.com)' }
            });

            if (!res.ok) {
                throw new Error(`API Error: ${res.status} ${res.statusText}`);
            }

            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (jsonErr) {
                console.error('JSON Parse Error. Response was:', text.substring(0, 200));
                return [];
            }

            if (data.error) return [];

            const html = data.parse.text['*'];
            // Use JSDOM instead of DOMParser
            const dom = new JSDOM(html);
            const doc = dom.window.document;

            const anchors = doc.querySelectorAll('a[href^="/wiki/"]');
            const rawTitles = new Set();

            for (const a of anchors) {
                const href = a.getAttribute('href');
                let linkTitle = decodeURIComponent(href.replace('/wiki/', ''));
                if (linkTitle.includes(':') || linkTitle.includes('#')) continue;
                linkTitle = linkTitle.replace(/_/g, ' ');
                rawTitles.add(linkTitle);
            }

            const uniqueTitles = Array.from(rawTitles);
            const normalizedLinks = [];
            for (let i = 0; i < uniqueTitles.length; i += this.MAX_TITLES_PER_QUERY) {
                const chunk = uniqueTitles.slice(i, i + this.MAX_TITLES_PER_QUERY);
                const normChunk = await this.batchNormalize(chunk);
                normalizedLinks.push(...normChunk);
            }

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
            const res = await fetch(`${API_BASE}?${params}`, {
                headers: { 'User-Agent': 'WikiSolverBot/1.0 (mailto:example@example.com)' }
            });
            const data = await res.json();
            const results = [];
            const pages = data.query.pages || {};

            Object.values(pages).forEach(p => {
                if (!p.missing && p.title) {
                    results.push(p.title);
                }
            });

            return results;
        } catch (e) {
            return titles;
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
            const res = await fetch(`${API_BASE}?${params}`, {
                headers: { 'User-Agent': 'WikiSolverBot/1.0 (mailto:example@example.com)' }
            });
            const data = await res.json();
            return data.query.backlinks.map(b => b.title);
        } catch (e) {
            return [];
        }
    }

    async convertPathToTC(path) {
        if (!path || path.length === 0) return path;
        console.log('正在進行最終繁體中文轉換...');
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

            const res = await fetch(`${API_BASE}?${params}`, {
                headers: { 'User-Agent': 'WikiSolverBot/1.0 (mailto:example@example.com)' }
            });
            const data = await res.json();

            if (data.parse && data.parse.text) {
                const dom = new JSDOM(data.parse.text['*']);
                const rawText = dom.window.document.body.textContent || "";
                let convertedItems = rawText.split(separator).map(s => s.trim());

                if (convertedItems.length === path.length) {
                    return convertedItems;
                }
            }
            return path;
        } catch (e) {
            console.error('Conversion Failed:', e);
            return path;
        }
    }
}
