# Better Claude

A Firefox extension that improves the [Claude.ai](https://claude.ai) experience for RTL language (Hebrew and Arabic) speakers.

## Current features (v1.0)

- Automatic right-to-left (RTL) alignment for Hebrew and Arabic content in chats. Direction is detected per paragraph based on character ratio, with RTL as the default and LTR applied only when Latin characters clearly dominate.
- Input direction toggle: **Ctrl+Right Shift** sets the input box to RTL, **Ctrl+Left Shift** sets it to LTR. Whole-input direction (per-paragraph direction in the input is planned for a future version).

## Planned features

- RTL support in the input textbox, including a Windows-style Ctrl+Shift toggle.
- Per-column direction in tables.
- Direction-aware inline code blocks.
- Usage statistics display (current usage and reset time from Claude's settings page).
- In-extension feedback link.
- Configurable settings page.
- More - let me know what you'd like this extension to do for you.

## Note

This is an unofficial, third-party extension. It is not affiliated with or endorsed by Anthropic.

## Installation (development / temporary)

The extension is currently in early release. To install it:

1. Clone or download this repository.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click **"Load Temporary Add-on..."**.
4. Select the `manifest.json` file from this repository.
5. Open or refresh any [Claude.ai](https://claude.ai) tab. Hebrew and Arabic content should now be aligned correctly.

Temporary add-ons are removed when Firefox is closed. Repeat the steps above after each restart, or wait for the extension to be published to the official Firefox Add-ons store.

## Reporting bugs and requesting features

**For technical users:** open an issue on [GitHub Issues](https://github.com/AssafTzurEl/better-claude/issues). Please include your Firefox version, a description of what you expected, what actually happened, and a screenshot if possible.

**For everyone else:** email [better-claude@pashut.co.il](mailto:better-claude@pashut.co.il) with a description of the problem and a screenshot if you can take one. Please mention which browser and operating system you're using.

Hebrew and English are both fine for issues and emails.

## How it works

The extension uses a content script that runs on Claude.ai pages. It scans the chat content, counts Hebrew/Arabic vs. Latin characters in each paragraph, list, heading, and blockquote, and applies the appropriate text direction. A `MutationObserver` watches for new content (such as Claude's streaming responses) and re-applies direction as the chat updates.

For the input box, a keyboard listener handles Ctrl+Right Shift and Ctrl+Left Shift to switch direction. This matches the Microsoft Word convention.

The extension does not collect or transmit any data. All processing happens locally in your browser.

## Privacy

The extension reads only the page content of Claude.ai tabs and modifies their visual layout. No data is collected, stored, or sent anywhere.

## License

MIT - see [LICENSE](./LICENSE) for details.

---

## And now in Hebrew

Better Claude הוא תוסף לפיירפוקס שמשפר את השימוש ב-[Claude.ai](https://claude.ai) עבור דוברי עברית וערבית.

### תכונות בגרסה הנוכחית (1.0)

- יישור אוטומטי מימין לשמאל (RTL) לטקסט בעברית ובערבית בצ'אטים. הכיוון מזוהה לכל פסקה לפי יחס תווים, כשברירת המחדל היא RTL ו-LTR מוחל רק כשתווים לטיניים בולטים בבירור.
- מעבר כיוון בתיבת הקלט: **Ctrl+Shift ימני** מחיל RTL, **Ctrl+Shift שמאלי** מחיל LTR. הכיוון מוחל לכל תיבת הקלט (כיוון פר-פסקה בתיבת הקלט מתוכנן לגרסה עתידית).

### תכונות מתוכננות
- כיוון טקסט בתיבת הקלט עבור כל פסקה בנפרד.
- כיוון עמודה בטבלאות.
- קוד inline מודע לכיוון.
- הצגת נתוני שימוש (שימוש נוכחי וזמן איפוס מעמוד ההגדרות של Claude).
- קישור משוב מתוך התוסף.
- עמוד הגדרות מותאם אישית.
- מוזמנות ומוזמנים לשלוח בקשות לתכונות חדשות.

זהו תוסף לא רשמי של צד שלישי. הוא אינו קשור ל-Anthropic או מאושר על ידיה.

### התקנה

ראו את ההוראות באנגלית למעלה.

## דיווח על באגים ובקשות לתכונות

**למשתמשים טכניים:** פתחו issue ב-[GitHub Issues](https://github.com/AssafTzurEl/better-claude/issues).

**לכולם:** שלחו אימייל ל-[better-claude@pashut.co.il](mailto:better-claude@pashut.co.il) עם תיאור של הבעיה וצילום מסך אם אפשר. ציינו באיזה דפדפן ומערכת הפעלה אתם משתמשים.

ניתן לפנות בעברית או באנגלית.