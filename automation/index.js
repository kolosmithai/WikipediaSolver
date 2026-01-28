
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

/**
 * 獲取台灣時區的日期字串 (YYYY-MM-DD)
 * @param {number} offsetDays 相對今日的偏移天數
 */
function getTaiwanDateString(offsetDays = 0) {
    const now = new Date();
    if (offsetDays !== 0) {
        now.setDate(now.getDate() + offsetDays);
    }
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);
}

// Helper to ensure directory exists
function ensureOutputDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

async function getDailyChallenge() {
    // 根據用戶要求，我們一律解「前一天」的題目以確保安全性
    const dateString = getTaiwanDateString(-1);

    console.log(`正在查詢前一日題目 (${dateString})...`);
    try {
        const docRef = doc(db, 'daily_puzzles', dateString);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
            const data = snap.data();
            console.log(`獲取成功！\n目標題目：${data.start} → ${data.target}`);
            return { start: data.start, target: data.target };
        } else {
            console.error(`找不到題目 (${dateString})。`);
            return null;
        }
    } catch (e) {
        console.error('Firebase 連線錯誤:', e.message);
        return null;
    }
}

async function runPosting(data, args) {
    try {
        console.log(`已載入解題結果：${data.path.join(' → ')}`);

        const now = new Date();
        const tomorrow08 = new Date(now);
        tomorrow08.setDate(tomorrow08.getDate() + 1);
        tomorrow08.setHours(8, 0, 0, 0);

        const postTime = args.includes('--now') ? null : tomorrow08;
        await scheduleThreadsPost(app, data.imagePaths, data.postContent, postTime);
        console.log('✅ 發文指令已發送完成！');
    } catch (e) {
        console.error('發文程序終止。');
    }
}

async function main() {
    const args = process.argv.slice(2);
    const onlyPost = args.includes('--only-post');

    // Special Case: Only Post (Read from existing metadata)
    if (onlyPost) {
        console.log('\n[Phase] Only Post mode. Loading metadata...');
        const todayStr = getTaiwanDateString(0);
        const metaPath = path.join(OUTPUT_DIR_BASE, todayStr, 'metadata.json');

        if (!fs.existsSync(metaPath)) {
            console.error(`找不到日期為 ${todayStr} 的 metadata.json。`);
            process.exit(1);
        }

        const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        await runPosting(data, args);
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

    // --- Dynamic Output Directory (Based on Taiwan Today) ---
    const todayStr = getTaiwanDateString(0);
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
        const challengeDateStr = getTaiwanDateString(-1).replace(/-/g, '/');
        const finalOutput = `
繁體中文維基百科接龍每日挑戰 ${challengeDateStr}

起點：${result.path[0]}
終點：${result.path[result.path.length - 1]}
最速步數：${result.path.length - 1} 步

參考路徑：
${result.path.join(' → ')}

今日冷知識：【${triviaTerm}】
${triviaContent}

 
 WikiGame 每日挑戰 冷知識
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
        await runPosting(metadata, args);

        // Success exit
        process.exit(0);

    } catch (e) {
        console.error('\n錯誤:', e.message);
        process.exit(1);
    }
}

main();
