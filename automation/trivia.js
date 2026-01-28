
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const HISTORY_FILE = 'history.json';

function loadHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
    return { terms: [] };
}

function saveHistory(history) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

export async function generateTrivia(term) {
    const history = loadHistory();

    // Check if term was already explained
    if (history.terms.includes(term)) {
        console.log(`[Trivia] Term "${term}" already explained. Skipping.`);
        return null;
    }

    console.log(`[Trivia] Generating cold knowledge for: ${term}`);

    try {
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: "你是一個專業且幽默的維基百科冷知識專家。請針對給定的詞彙，提供一個簡短（100字以內）、有趣、且確實存在、有據可查的冷知識。重要規則：1. 必須基於事實，嚴禁虛構或幻想。2. 必須使用『正體中文（台灣繁體）』。3. 絕對『禁止』使用簡體字。4. 絕對『禁止』使用任何表情符號 (Emoji)。" },
                { role: "user", content: `請介紹關於「${term}」的真正冷知識，字數要在 100 字內：` }
            ],
            model: "gpt-4o-mini",
        });

        const content = completion.choices[0].message.content;

        // Save to history
        history.terms.push(term);
        saveHistory(history);

        return content;
    } catch (error) {
        console.error("OpenAI API Error:", error);
        return "暫無法取得冷知識，請稍後再試。"; // Fallback
    }
}
