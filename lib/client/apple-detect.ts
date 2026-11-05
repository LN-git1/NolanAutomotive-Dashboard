/**
 * Marks the document as running on an Apple touch device, before first paint.
 *
 * Why this exists: the dashboard is one codebase for every device, but on an
 * iPhone or iPad it should feel like a native iOS app (translucent bars, iOS
 * press feedback, landscape safe areas, a gentle page-enter motion) while every
 * other device stays exactly as it was. All of that polish is written in CSS
 * under `html[data-apple]`, so the only decision this file makes is whether to
 * set that one attribute.
 *
 * It is an inline script, not a React effect or a server-side User-Agent check:
 *  - Reading `headers()` in the root layout would force every page to render
 *    dynamically, throwing away the static prerendering the app relies on.
 *  - An effect runs after first paint, so the page would flash in its plain
 *    style and then snap into the iOS one.
 * `<html>` already carries `suppressHydrationWarning` for the theme script, so
 * an attribute set before hydration causes no mismatch.
 *
 * Detection: iPhone, iPad and iPod say so in the User-Agent. iPadOS 13+ asks
 * for the desktop site by default and reports itself as a Mac, so a "Mac" that
 * also has a multi-touch screen is an iPad (no real Mac reports touch points).
 * Desktop Safari on a Mac is matched too (decided with the owner): a "Macintosh"
 * User-Agent with none of the other browsers' tokens. Chrome, Edge, Opera, Brave
 * and Arc all carry a "Chrome" token and Firefox carries "Firefox", while Safari
 * carries neither — so a Mac running any of those stays on the plain look.
 *
 * `data-standalone` is set when launched from the Home Screen, so CSS can tell
 * "installed app" apart from "a tab in Safari" (for example, to hide hints that
 * only make sense in a browser tab).
 *
 * Written as ES5 inside try/catch: it runs on the critical path of every load
 * and must never be the reason a page fails to render.
 */
export const APPLE_DETECT_SCRIPT = `(function(){try{var d=document.documentElement,n=navigator,ua=n.userAgent||'';var macSafari=/Macintosh/.test(ua)&&!/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);if(/iPhone|iPad|iPod/.test(ua)||macSafari||(n.platform==='MacIntel'&&n.maxTouchPoints>1)){d.dataset.apple='1';if(n.standalone||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)){d.dataset.standalone='1';}}}catch(e){}})();`;
