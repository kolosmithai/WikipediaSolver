/**
 * Utility Functions
 * The Wikipedia Game
 */

/**
 * HTML 轉義函式，防止 XSS 攻擊
 * 將特殊字元轉換為 HTML entities
 * @param {string} text - 需要轉義的文字
 * @returns {string} - 轉義後的安全文字
 */
export function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') return String(text);

    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 取得今日的 YYYY-MM-DD 日期字串
 * 使用本地時間，手動格式化以避免 Intl 差異
 * @returns {string} e.g. "2026-01-25"
 */
export function getTodayString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
