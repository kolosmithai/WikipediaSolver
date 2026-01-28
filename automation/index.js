
import { PathSolver } from './solver_node.js';
import { generateStepImage } from './image_gen.js';
import { generateTrivia } from './trivia.js';
import { scheduleThreadsPost } from './threads_api.js';
import fs from 'fs';
import path from 'path';
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// --- Firebase Config ---
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyDKlLhz8XHiFb133d3n1nNCP5ib3G6D_G4",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "wikipedia-game-tw.firebaseapp.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "wikipedia-game-tw",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "wikipedia-game-tw.firebasestorage.app",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "211640570574",
    appId: process.env.FIREBASE_APP_ID || "1:211640570574:web:bb9b57dbaef859833bf69f",
    measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-R0QXS9XBWE"
};

// Initialize Firebase (Client SDK)
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const OUTPUT_DIR_BASE = './output';

// Helper to ensure directory exists
function ensureOutputDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

async function getDailyChallenge() {
    const date = new Date();
    // Use local date string (YYYY-MM-DD)
    const dateString = date.toLocaleDateString('en-CA');

    console.log(`正在查詢今日題目 (${dateString})...`);
    try {
        const docRef = doc(db, 'daily_puzzles', dateString);
        let snap = await getDoc(docRef);

        if (!snap.exists()) {
            console.log('今日無題目，嘗試查詢昨日...');
            date.setDate(date.getDate() - 1);
            const yString = date.toLocaleDateString('en-CA');
            snap = await getDoc(doc(db, 'daily_puzzles', yString));
        }

        if (snap.exists()) {
            const data = snap.data();
            console.log(`獲取成功！\n今日目標：${data.start} → ${data.target}`);
            return { start: data.start, target: data.target };
        } else {
            console.error('找不到今日或昨日的題目。使用預設值。');
            return null;
        }
    } catch (e) {
        console.error('Firebase 連線錯誤:', e.message);
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const onlyPost = args.includes('--only-post');

    // Special Case: Only Post (Read from existing metadata)
    if (onlyPost) {
        console.log('\n[Phase] Only Post mode. Loading metadata...');
        const todayStr = new Date().toLocaleDateString('en-CA');
        const metaPath = path.join(OUTPUT_DIR_BASE, todayStr, 'metadata.json');

        if (!fs.existsSync(metaPath)) {
            console.error('找不到 metadata.json，無法單獨執行發文方案。');
            process.exit(1);
        }

        const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        console.log(`已載入解題結果：${data.path.join(' → ')}`);

        try {
            const now = new Date();
            const tomorrow08 = new Date(now);
            tomorrow08.setDate(tomorrow08.getDate() + 1);
            tomorrow08.setHours(8, 0, 0, 0);

            // Support --now for immediate posting
            const postTime = args.includes('--now') ? null : tomorrow08;

            await scheduleThreadsPost(app, data.imagePaths, data.postContent, postTime);
            console.log('✅ 發文指令已發送完成！');
        } catch (e) {
            // Error already logged in threads_api.js, so we just log the summary here
            console.error('發文程序終止。');
        }
        process.exit(0);
    }

    const solver = new PathSolver();

    console.log('==========================================');
    console.log('      維基百科接龍 自動發文工具');
    console.log('==========================================');

    let start = process.argv[2];
    let target = process.argv[3];

    // If no CLI args, try fetching Daily Challenge
    if (!start || !target) {
        const daily = await getDailyChallenge();
        if (daily) {
            start = daily.start;
            target = daily.target;
        } else {
            start = '蘋果';
            target = '黑洞';
            console.log(`使用預設題目：${start} → ${target}`);
        }
    } else {
        console.log(`使用手動輸入：${start} → ${target}`);
    }

    // --- Dynamic Output Directory ---
    const todayStr = new Date().toLocaleDateString('en-CA');
    const OUTPUT_DIR = path.join(OUTPUT_DIR_BASE, todayStr);

    try {
        ensureOutputDir(OUTPUT_DIR);
        console.log(`輸出目錄：${OUTPUT_DIR}`);

        // 1. Solve Path
        console.log('\n開始解題...');
        const result = await solver.run(start, target, (progress, msg) => {
            // Optional: progress logging
            process.stdout.write(`\r[Solver] ${msg}`.padEnd(50));
        });

        if (!result || !result.path) {
            console.error('\n解題失敗，找不到路徑。');
            process.exit(1);
        }

        // FORCE FULL TC CONVERSION
        console.log('\n\n正在優化文字為繁體中文...');
        result.path = await solver.convertPathToTC(result.path);

        console.log('\n路徑已找到！');
        console.log('路徑:', result.path.join(' -> '));

        // 2. Generate Images
        console.log('\n正在生成圖片...');
        const imagePaths = [];
        for (let i = 0; i < result.path.length; i++) {
            const current = result.path[i];
            const prev = i > 0 ? result.path[i - 1] : null;
            const next = i < result.path.length - 1 ? result.path[i + 1] : null;

            const imgPath = await generateStepImage({
                stepIndex: i + 1,
                totalSteps: result.path.length,
                currentTitle: current,
                prevTitle: prev,
                nextTitle: next
            }, OUTPUT_DIR);

            imagePaths.push(imgPath);
            process.stdout.write('.');
        }
        console.log(`\n圖片已生成於 ${OUTPUT_DIR}`);

        // 3. Select Trivia Topic
        let candidates = result.path;
        if (candidates.length > 2) {
            candidates = [...result.path];
        }
        candidates.sort(() => Math.random() - 0.5);

        let triviaContent = null;
        let triviaTerm = null;

        console.log('\n正在生成冷知識...');
        for (const term of candidates) {
            const trivia = await generateTrivia(term);
            if (trivia) {
                triviaContent = trivia;
                triviaTerm = term;
                break; // Found one!
            }
        }

        if (!triviaContent) {
            console.log('無法生成新的冷知識（可能所有詞彙都已在歷史紀錄中）。');
            triviaContent = "（今日無冷知識，請欣賞路徑！）";
            triviaTerm = "無";
        }

        // 4. Final Output Construction
        const finalOutput = `
維基百科每日路徑挑戰

起點：${result.path[0]}
終點：${result.path[result.path.length - 1]}
最速步數：${result.path.length - 1} 步

參考路徑：
${result.path.join(' → ')}

今日冷知識：【${triviaTerm}】
${triviaContent}

#WikiGame #每日挑戰 #冷知識
`;

        console.log('\n==========================================');
        console.log('貼文內容準備完成 (可直接複製)');
        console.log('==========================================');
        console.log(finalOutput);
        console.log('==========================================');

        // Save text file too
        fs.writeFileSync(path.join(OUTPUT_DIR, 'post_content.txt'), finalOutput);
        console.log('檔案已儲存至 ' + OUTPUT_DIR);

        // --- PREPARE METADATA ---
        const metadata = {
            path: result.path,
            imagePaths: imagePaths,
            postContent: finalOutput,
            triviaTerm: triviaTerm
        };
        fs.writeFileSync(path.join(OUTPUT_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // --- PHASED EXECUTION ---
        const args = process.argv.slice(2);
        const onlyImages = args.includes('--only-images');
        const onlyPost = args.includes('--only-post');

        if (onlyImages) {
            console.log('\n[Phase] Only Images mode. Skipping Threads API call.');
            console.log('✅ Success! Images and Metadata generated.');
            process.exit(0);
        }

        // --- Threads Scheduling ---
        try {
            // Calculate Schedule Time: Tomorrow 08:00
            const now = new Date();
            const tomorrow08 = new Date(now);
            tomorrow08.setDate(tomorrow08.getDate() + 1);
            tomorrow08.setHours(8, 0, 0, 0);

            const postTime = args.includes('--now') ? null : tomorrow08;
            await scheduleThreadsPost(app, imagePaths, finalOutput, postTime);

        } catch (e) {
            console.error('\n⚠️ Threads 發文程序失敗。');
        }

        // Success exit
        process.exit(0);

    } catch (e) {
        console.error('\n錯誤:', e.message);
        process.exit(1);
    }
}

main();
