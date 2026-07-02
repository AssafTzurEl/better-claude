# Better Claude

A Firefox extension that improves the [Claude.ai](https://claude.ai) experience for RTL language (Hebrew and Arabic) speakers.

## Current features (v1.1)

- Automatic right-to-left (RTL) alignment for Hebrew and Arabic content in chats. Direction is detected per paragraph based on character ratio, with RTL as the default and LTR applied only when Latin characters clearly dominate.
- Input direction toggle: **Ctrl+Right Shift** sets the input box to RTL, **Ctrl+Left Shift** sets it to LTR. Whole-input direction (per-paragraph direction in the input is planned for a future version).
- **Live usage bars:** Session (5-hour) and weekly usage bars in the chat header, showing the current percentage used and the next reset time. Bars refresh automatically, and a manual ↻ button is also available.

## Planned features

- RTL support in the input textbox, including a Windows-style Ctrl+Shift toggle.
- Per-column direction in tables.
- Direction-aware inline code blocks.
- In-extension feedback link.
- Configurable settings page (including an on/off toggle for the usage bars).
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

The extension uses two content scripts that run on Claude.ai pages.

The RTL script scans the chat content, counts Hebrew/Arabic vs. Latin characters in each paragraph, list, heading, and blockquote, and applies the appropriate text direction. A `MutationObserver` watches for new content (such as Claude's streaming responses) and re-applies direction as the chat updates. A keyboard listener handles Ctrl+Right Shift and Ctrl+Left Shift to switch the input box direction, matching the Microsoft Word convention.

The usage script calls Claude's own same-origin `/api/organizations/{orgId}/usage` endpoint (the same one Claude's settings page uses), parses the session and weekly limits, and renders them as thin bars in the chat header. No external requests — the fetch uses the same session cookies the browser already has. Refresh is triggered by user activity (sending messages, generation ending, tab becoming visible) and a manual button; a debounce prevents hammering the API.

The extension does not collect or transmit any data. All processing happens locally in your browser.

## Privacy

The extension reads only the page content of Claude.ai tabs and modifies their visual layout. No data is collected, stored, or sent anywhere.

## License

MIT - see [LICENSE](./LICENSE) for details.

---

## And now in Hebrew

Better Claude הוא תוסף לפיירפוקס שמשפר את השימוש ב-[Claude.ai](https://claude.ai) עבור דוברי עברית וערבית.

### תכונות בגרסה הנוכחית (1.1)

- יישור אוטומטי מימין לשמאל (RTL) לטקסט בעברית ובערבית בצ'אטים. הכיוון מזוהה לכל פסקה לפי יחס תווים, כשברירת המחדל היא RTL ו-LTR מוחל רק כשתווים לטיניים בולטים בבירור.
- מעבר כיוון בתיבת הקלט: **Ctrl+Shift ימני** מחיל RTL, **Ctrl+Shift שמאלי** מחיל LTR. הכיוון מוחל לכל תיבת הקלט (כיוון פר-פסקה בתיבת הקלט מתוכנן לגרסה עתידית).
- **סרגלי שימוש חיים:** סרגלי session (5 שעות) ו-weekly בכותרת הצ'אט, עם אחוז השימוש הנוכחי וזמן האיפוס. הסרגלים מתרעננים אוטומטית בשליחת הודעה, בסיום תגובה, כל 10 שניות בזמן יצירת תגובה ובחזרה לכרטיסייה. כפתור ↻ לרענון ידני.

### תכונות מתוכננות
- כיוון טקסט בתיבת הקלט עבור כל פסקה בנפרד.
- כיוון עמודה בטבלאות.
- קוד inline מודע לכיוון.
- קישור משוב מתוך התוסף.
- עמוד הגדרות מותאם אישית (כולל הפעלה/כיבוי של סרגלי השימוש).
- מוזמנות ומוזמנים לשלוח בקשות לתכונות חדשות.

זהו תוסף לא רשמי של צד שלישי. הוא אינו קשור ל-Anthropic או מאושר על ידיה.

### התקנה

התקינו את Better Claude מ[דף התוספים של Firefox](https://addons.mozilla.org/en-US/firefox/addon/better-claude).

## דיווח על באגים ובקשות לתכונות

**למשתמשים טכניים:** פתחו issue ב-[GitHub Issues](https://github.com/AssafTzurEl/better-claude/issues).

**לכולם:** שלחו אימייל ל-[better-claude@pashut.co.il](mailto:better-claude@pashut.co.il) עם תיאור של הבעיה וצילום מסך אם אפשר. ציינו באיזה דפדפן ומערכת הפעלה אתם משתמשים.

ניתן לפנות בעברית או באנגלית.