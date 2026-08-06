# Better Claude

A Firefox extension that improves the [Claude.ai](https://claude.ai) experience for RTL language (Hebrew and Arabic) speakers.

## Current features (v1.2)

- Automatic right-to-left (RTL) alignment for Hebrew and Arabic content in chats. Direction is detected per paragraph based on character ratio, with RTL as the default and LTR applied only when Latin characters clearly dominate.
- Input direction toggle: **Ctrl+Right Shift** sets the input box to RTL, **Ctrl+Left Shift** sets it to LTR. Whole-input direction (per-paragraph direction in the input is planned for a future version).
- **Live usage bars:** Session (5-hour) and weekly usage bars in the chat header, showing the current percentage used and the next reset time. Bars refresh automatically, and a manual ↻ button is also available.
- **Settings page:** open it from `about:addons` → Better Claude → Preferences. It sets how aggressively mixed-language paragraphs flip to left-to-right, the direction a message box starts in, whether the usage bars are shown, and whether debug logging is on. Changes take effect in open Claude.ai tabs immediately, with no reload.

## Planned features

- Per-paragraph direction inside the input box.
- Per-column direction in tables.
- Direction-aware inline code blocks.
- In-extension feedback link.
- More - let me know what you'd like this extension to do for you.

## Note

This is an unofficial, third-party extension. It is not affiliated with or endorsed by Anthropic.

## Installation

Install Better Claude from the [Firefox Add-ons page](https://addons.mozilla.org/en-US/firefox/addon/better-claude).

## Reporting bugs and requesting features

**For technical users:** open an issue on [GitHub Issues](https://github.com/AssafTzurEl/better-claude/issues). Please include your Firefox version, a description of what you expected, what actually happened, and a screenshot if possible.

**For everyone else:** email [better-claude@pashut.co.il](mailto:better-claude@pashut.co.il) with a description of the problem and a screenshot if you can take one. Please mention which browser and operating system you're using.

Hebrew and English are both fine for issues and emails.

## How it works

The extension uses three content scripts that run on Claude.ai pages.

The settings script runs first and is shared by the other two: it reads your preferences from `browser.storage.sync`, falls back to the built-in defaults if storage is unavailable or holds an unusable value, and tells the other scripts when something changes so they can react without a page reload. The settings page itself (`about:addons` → Preferences) writes to the same storage and validates against the same table.

The RTL script scans the chat content, counts Hebrew/Arabic vs. Latin characters in each paragraph, list, heading, and blockquote, and applies the appropriate text direction. A `MutationObserver` watches for new content (such as Claude's streaming responses) and re-applies direction as the chat updates. A keyboard listener handles Ctrl+Right Shift and Ctrl+Left Shift to switch the input box direction, matching the Microsoft Word convention.

The usage script calls Claude's own same-origin `/api/organizations/{orgId}/usage` endpoint (the same one Claude's settings page uses), parses the session and weekly limits, and renders them as thin bars in the chat header. No external requests — the fetch uses the same session cookies the browser already has. Refresh is triggered by user activity (sending messages, generation ending, tab becoming visible) and a manual button; a debounce prevents hammering the API.

The extension does not collect or transmit any data. All processing happens locally in your browser.

## Privacy

The extension reads only the page content of Claude.ai tabs and modifies their visual layout. Nothing about you or your chats is collected or sent anywhere.

The only thing it stores is your own settings — four values, in the browser's own extension storage. If you are signed in to a Firefox Account, Firefox syncs that storage to your other devices, the same way it syncs your bookmarks; if you are not, it never leaves the machine. Either way it goes to Mozilla, never to this extension's author.

## License

MIT - see [LICENSE](./LICENSE) for details.

---

## And now in Hebrew

Better Claude הוא תוסף לפיירפוקס שמשפר את השימוש ב-[Claude.ai](https://claude.ai) עבור דוברי עברית וערבית.

### תכונות בגרסה הנוכחית (1.2)

- יישור אוטומטי מימין לשמאל (RTL) לטקסט בעברית ובערבית בצ'אטים. הכיוון מזוהה לכל פסקה לפי יחס תווים, כשברירת המחדל היא RTL ו-LTR מוחל רק כשתווים לטיניים בולטים בבירור.
- מעבר כיוון בתיבת הקלט: **Ctrl+Shift ימני** מחיל RTL, **Ctrl+Shift שמאלי** מחיל LTR. הכיוון מוחל לכל תיבת הקלט (כיוון פר-פסקה בתיבת הקלט מתוכנן לגרסה עתידית).
- **סרגלי שימוש חיים:** סרגלי session (5 שעות) ו-weekly בכותרת הצ'אט, עם אחוז השימוש הנוכחי וזמן האיפוס. הסרגלים מתרעננים אוטומטית בשליחת הודעה, בסיום תגובה, כל 10 שניות בזמן יצירת תגובה ובחזרה לכרטיסייה. כפתור ↻ לרענון ידני.
- **עמוד הגדרות:** נפתח דרך `about:addons` ← Better Claude ← העדפות. אפשר לקבוע בו עד כמה בקלות פסקאות מעורבות עוברות לכיוון משמאל לימין, באיזה כיוון תיבת ההודעה מתחילה, האם להציג את סרגלי השימוש והאם להפעיל רישום ניפוי שגיאות. שינוי נכנס לתוקף מיד בכל כרטיסיות Claude.ai הפתוחות, בלי לרענן.

### תכונות מתוכננות
- כיוון טקסט בתיבת הקלט עבור כל פסקה בנפרד.
- כיוון עמודה בטבלאות.
- קוד inline מודע לכיוון.
- קישור משוב מתוך התוסף.
- מוזמנות ומוזמנים לשלוח בקשות לתכונות חדשות.

זהו תוסף לא רשמי של צד שלישי. הוא אינו קשור ל-Anthropic או מאושר על ידיה.

### התקנה

התקינו את Better Claude מ[דף התוספים של Firefox](https://addons.mozilla.org/en-US/firefox/addon/better-claude).

## דיווח על באגים ובקשות לתכונות

**למשתמשים טכניים:** פתחו issue ב-[GitHub Issues](https://github.com/AssafTzurEl/better-claude/issues).

**לכולם:** שלחו אימייל ל-[better-claude@pashut.co.il](mailto:better-claude@pashut.co.il) עם תיאור של הבעיה וצילום מסך אם אפשר. ציינו באיזה דפדפן ומערכת הפעלה אתם משתמשים.

ניתן לפנות בעברית או באנגלית.