import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import 'dotenv/config';

// Threads API Config
const THREADS_USER_ID = process.env.THREADS_USER_ID;
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;

// 1. GitHub URL Helper (Replaces Firebase Storage)
export async function getGitHubImageUrl(localPath) {
    // localPath example: './automation/output/2026-01-28/step_1.png'
    // We need to convert it to a GitHub Raw URL:
    // https://raw.githubusercontent.com/kolosmithai/WikipediaSolver/main/automation/automation/output/2026-01-28/step_1.png

    // Note: The 'automation' folder is nested in the repo as 'automation/'
    // So the path in the repo is 'automation/output/...' 
    // BUT looking at the list_dir, the localPath passed from index.js is likely relative.

    const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/kolosmithai/WikipediaSolver/main';

    // Normalize path: remove './' and use forward slashes
    let normalizedPath = localPath.replace(/\\/g, '/');
    if (normalizedPath.startsWith('./')) {
        normalizedPath = normalizedPath.substring(2);
    }

    // In the repo structure, the 'automation' folder is top-level.
    // If localPath is './output/xxx', we want automation/output/xxx
    let finalPathInRepo = normalizedPath;
    if (!finalPathInRepo.includes('automation/')) {
        finalPathInRepo = 'automation/' + finalPathInRepo;
    }
    const publicUrl = `${GITHUB_RAW_BASE}/${finalPathInRepo}`;

    console.log(`[GitHub Host] Generated URL: ${publicUrl}`);
    return publicUrl;
}

// 2. Threads API Helpers
const API_BASE = 'https://graph.threads.net/v1.0';

async function fetchMeta(path, params = {}) {
    // Add access_token to params
    const searchParams = new URLSearchParams({
        ...params,
        access_token: THREADS_ACCESS_TOKEN
    });

    const url = `${API_BASE}/${path}?${searchParams.toString()}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();

    if (data.error) {
        console.error(`[API Error] Path: ${path}`);
        console.error(JSON.stringify(data.error, null, 2));
        throw new Error(data.error.message);
    }
    return data;
}

async function createItemContainer(imageUrl) {
    return fetchMeta(`${THREADS_USER_ID}/threads`, {
        media_type: 'IMAGE',
        image_url: imageUrl,
        is_carousel_item: 'true'
    });
}

async function createCarouselContainer(text, itemIds, scheduleTime) {
    const params = {
        media_type: 'CAROUSEL',
        children: itemIds.join(','),
        text: text
    };

    if (scheduleTime) {
        params.scheduled_publish_time = scheduleTime;
    }

    return fetchMeta(`${THREADS_USER_ID}/threads`, params);
}

async function publishContainer(containerId) {
    return fetchMeta(`${THREADS_USER_ID}/threads_publish`, {
        creation_id: containerId
    });
}

// Helper for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 3. Main Workflow
export async function scheduleThreadsPost(firebaseApp, imagePaths, text, scheduleDate) {
    if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
        console.warn('⚠️ THREADS_USER_ID or THREADS_ACCESS_TOKEN is missing. Skipping Method.');
        return;
    }

    console.log('\n🧵 Starting Threads Scheduling...');

    // A. Generate All Public URLs
    const publicUrls = [];
    for (let i = 0; i < imagePaths.length; i++) {
        const url = await getGitHubImageUrl(imagePaths[i]);
        publicUrls.push(url);
    }

    // B. Create Item Containers
    const itemIds = [];
    for (const url of publicUrls) {
        const result = await createItemContainer(url);
        itemIds.push(result.id);
        console.log(`[Threads] Item Container Created: ${result.id}`);
        // Small delay between items to be polite to API
        await sleep(2000);
    }

    // --- CRITICAL DELAY ---
    // Meta/Threads needs time to crawl the images from GitHub before they can be used in a Carousel.
    console.log(`[Threads] Waiting 10 seconds for Meta to process images...`);
    await sleep(10000);

    // C. Create Main Carousel Container
    let timestamp = null;
    if (scheduleDate) {
        timestamp = Math.floor(scheduleDate.getTime() / 1000);
        console.log(`[Threads] Scheduling for ${scheduleDate.toISOString()} (TS: ${timestamp})`);
    } else {
        console.log(`[Threads] Posting IMMEDIATELY...`);
    }

    const carouselResult = await createCarouselContainer(text, itemIds, timestamp);
    const containerId = carouselResult.id;
    console.log(`[Threads] Carousel Container Created: ${containerId}`);

    // D. Publish
    // Important: For scheduled posts, call publishContainer to "confirm" the schedule
    // For immediate posts, call publishContainer to "go live"
    await publishContainer(containerId);

    if (timestamp) {
        console.log(`[Threads] ✅ Successfully Scheduled!`);
    } else {
        console.log(`[Threads] ✅ Successfully Published!`);
    }
}
