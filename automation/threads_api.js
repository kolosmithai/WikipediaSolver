import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import 'dotenv/config';

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
    // If localPath starts with 'automation/output', it's already correct.
    const publicUrl = `${GITHUB_RAW_BASE}/${normalizedPath}`;

    console.log(`[GitHub Host] Generated URL: ${publicUrl}`);
    return publicUrl;
}

// 2. Threads API Helpers
const API_BASE = 'https://graph.threads.net/v1.0';

async function createItemContainer(imageUrl) {
    const url = `${API_BASE}/${THREADS_USER_ID}/threads?media_type=IMAGE&image_url=${encodeURIComponent(imageUrl)}&is_carousel_item=true&access_token=${THREADS_ACCESS_TOKEN}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(`Create Item Error: ${data.error.message}`);
    return data.id;
}

async function createCarouselContainer(text, itemIds, scheduleTime) {
    // scheduleTime is Unix Timestamp (seconds)
    // If scheduleTime is provided, we set scheduled_publish_time and published=true (Wait, usually 'published=true' is for immediate?)
    // Actually for Threads, simply calling 'threads_publish' usually publishes it.
    // Documentation says to use 'scheduled_publish_time' on the CONTAINER creation.

    let url = `${API_BASE}/${THREADS_USER_ID}/threads?media_type=CAROUSEL&children=${itemIds.join(',')}&text=${encodeURIComponent(text)}&access_token=${THREADS_ACCESS_TOKEN}`;

    if (scheduleTime) {
        url += `&scheduled_publish_time=${scheduleTime}`;
    }

    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(`Create Carousel Error: ${data.error.message}`);
    return data.id;
}

async function publishContainer(containerId) {
    const url = `${API_BASE}/${THREADS_USER_ID}/threads_publish?creation_id=${containerId}&access_token=${THREADS_ACCESS_TOKEN}`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(`Publish Error: ${data.error.message}`);
    return data.id;
}

// 3. Main Workflow
export async function scheduleThreadsPost(firebaseApp, imagePaths, text, scheduleDate) {
    if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
        console.warn('⚠️ THREADS_USER_ID or THREADS_ACCESS_TOKEN is missing. Skipping Method.');
        return;
    }

    console.log('\n🧵 Starting Threads Scheduling...');

    // A. Upload All Images
    const publicUrls = [];
    const todayStr = new Date().toLocaleDateString('en-CA');

    for (let i = 0; i < imagePaths.length; i++) {
        const localPath = imagePaths[i];
        const fileName = path.basename(localPath);

        try {
            const url = await getGitHubImageUrl(localPath);
            publicUrls.push(url);
        } catch (e) {
            console.error(`URL generation failed for ${fileName}:`, e.message);
            throw e;
        }
    }

    // B. Create Item Containers
    const itemIds = [];
    for (const url of publicUrls) {
        const id = await createItemContainer(url);
        itemIds.push(id);
        // Rate limit logging/pause?
    }

    // C. Create Main Carousel Container with Schedule
    // Calculate timestamp
    const timestamp = Math.floor(scheduleDate.getTime() / 1000);
    console.log(`[Threads] Scheduling for ${scheduleDate.toISOString()} (TS: ${timestamp})`);

    const containerId = await createCarouselContainer(text, itemIds, timestamp);
    console.log(`[Threads] Carousel Container Created: ${containerId}`);

    // D. Publish (This confirms the schedule)
    await publishContainer(containerId);
    console.log(`[Threads] ✅ Successfully Scheduled!`);
}
