
import { ref, uploadBytes, getDownloadURL, getStorage } from "firebase/storage";
import { initializeApp } from "firebase/app";
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import 'dotenv/config';

// Re-use config or import it. For now, hardcoding based on previous file is safer 
// but reusing the app instance from index.js would be better if passed in.
// However, to keep this module standalone, we'll accept 'app' as an argument or init a new one if needed.
// BE CAREFUL: node-canvas/index.js initiates app too. 

// Threads API Config
const THREADS_USER_ID = process.env.THREADS_USER_ID;
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;

// 1. Upload Helper
export async function uploadImageToStorage(firebaseApp, localPath, remotePath) {
    if (!fs.existsSync(localPath)) throw new Error(`File not found: ${localPath}`);

    const storage = getStorage(firebaseApp);
    const fileBuffer = fs.readFileSync(localPath);
    const storageRef = ref(storage, remotePath); // e.g., 'daily_posts/2026-01-28/step_1.png'

    console.log(`[Firebase] Uploading ${path.basename(localPath)}...`);
    const snapshot = await uploadBytes(storageRef, fileBuffer);
    const publicUrl = await getDownloadURL(snapshot.ref);

    console.log(`[Firebase] Uploaded! URL: ${publicUrl}`);
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
        const remotePath = `daily_posts/${todayStr}/${fileName}`; // Organized path

        try {
            const url = await uploadImageToStorage(firebaseApp, localPath, remotePath);
            publicUrls.push(url);
        } catch (e) {
            console.error(`Upload failed for ${fileName}:`, e.message);
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
