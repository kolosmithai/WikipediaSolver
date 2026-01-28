
import { registerFont, createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Define assets directory for background
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, 'assets');

// 1. HARDCODED FONT PATH - Updated to use Assets Directory
const FONT_PATH = path.join(ASSETS_DIR, 'jfopenhuninn2.1.ttf');

// 2. Register Font
// Strategy: register it with a safe alias, but also try to invoke it by its internal Full Name
if (fs.existsSync(FONT_PATH)) {
    // Register as 'CustomFont' alias
    registerFont(FONT_PATH, { family: 'CustomFont' });
    console.log(`[Font] Registered from: ${FONT_PATH}`);
} else {
    console.error(`[Font] ERROR: File not found at ${FONT_PATH}`);
}

export async function generateStepImage(stepData, outputDir) {
    const { stepIndex, totalSteps, currentTitle, prevTitle, nextTitle } = stepData;

    const width = 1080;
    const height = 1080;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // --- Background Image ---
    const bgPath = path.join(ASSETS_DIR, 'background.png');
    if (fs.existsSync(bgPath)) {
        const bg = await loadImage(bgPath);
        ctx.drawImage(bg, 0, 0, width, height);
    } else {
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, width, height);
    }

    // --- Main Color ---
    const mainColor = '#2c2c2a';
    ctx.fillStyle = mainColor;

    // --- Main Content: Current Title ---
    // TRY CHAIN:
    // 1. 'CustomFont' (Our alias)
    // 2. 'jf openhuninn-2.1' (Internal Full Name)
    // 3. 'jf-openhuninn-2.1' (Internal Family Name)
    // 4. 'Microsoft JhengHei' (Safe Fallback for TC)
    ctx.font = '180px "CustomFont", "jf openhuninn-2.1", "jf-openhuninn-2.1", "Microsoft JhengHei"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text Wrapping logic
    const maxTextWidth = 950;
    const words = currentTitle.split('');
    let line = '';
    const lines = [];

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n];
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxTextWidth && n > 0) {
            lines.push(line);
            line = words[n];
        } else {
            line = testLine;
        }
    }
    lines.push(line);

    // Center vertically
    const lineHeight = 200;
    let startY = (height / 2) - ((lines.length - 1) * (lineHeight / 2));

    lines.forEach((l, i) => {
        ctx.fillText(l, width / 2, startY + (i * lineHeight));
    });

    // --- Context: Prev (Left) & Next (Right) ---
    ctx.font = '40px "CustomFont", "jf openhuninn-2.1", "jf-openhuninn-2.1", "Microsoft JhengHei"';
    ctx.fillStyle = '#666666';

    const padding = 80;
    const bottomY = height - 100;

    // Left: Prev
    if (prevTitle) {
        ctx.textAlign = 'left';
        ctx.fillText(`來自: ${prevTitle}`, padding, bottomY);
    }

    // Right: Next
    if (nextTitle) {
        ctx.textAlign = 'right';
        ctx.fillText(`前往: ${nextTitle}`, width - padding, bottomY);
    } else if (stepIndex === totalSteps) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#cfb929';
        ctx.fillText(`抵達終點`, width - padding, bottomY);
    }

    // --- Save ---
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const buffer = canvas.toBuffer('image/png');
    const fileName = `step_${stepIndex}.png`;
    const fullPath = path.join(outputDir, fileName);
    fs.writeFileSync(fullPath, buffer);

    return fullPath;
}
