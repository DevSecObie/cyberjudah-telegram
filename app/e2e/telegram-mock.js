/* A stand-in for telegram-web-app.js: enough of the Mini App API for the app to run, plus a
   window.__tg handle the tests use to press Telegram's buttons and read what the app set. */
(() => {
  // A reader who has already agreed, in Ask, to the providers the tests use (the Claude stand-in
  // and the Cloudflare-hosted free model), so tests about other things are not stopped by the
  // agreement card. The agreement tests set window.__noConsent to start from no agreement.
  try { if (!window.__noConsent && !localStorage.getItem("cj:ai-consent")) localStorage.setItem("cj:ai-consent", JSON.stringify(["Anthropic", "Cloudflare (Workers AI)"])); } catch (e) { /* no storage */ }
  const params = new URLSearchParams(location.hash.slice(1));
  const initData = params.get("tgWebAppData") || "";
  const user = (() => { try { return JSON.parse(new URLSearchParams(initData).get("user") || "null"); } catch { return null; } })();
  const version = params.get("tgWebAppVersion") || "9.1";
  const atLeast = (v) => { const a = version.split(".").map(Number), b = v.split(".").map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y; } return true; };
  const events = {};
  const cloud = { ...(window.__cloud || {}) }, device = {}, secureStore = {};
  const log = [];
  let popupCb = null;
  const mkStorage = (store) => ({
    setItem(k, v, cb) { store[k] = v; cb && cb(null, true); return this; },
    getItem(k, cb) { cb(null, store[k]); return this; },
    getItems(ks, cb) { cb(null, Object.fromEntries(ks.map((k) => [k, store[k] || ""]))); return this; },
    removeItem(k, cb) { delete store[k]; cb && cb(null, true); return this; },
    removeItems(ks, cb) { ks.forEach((k) => delete store[k]); cb && cb(null, true); return this; },
    getKeys(cb) { cb(null, Object.keys(store)); return this; },
    clear(cb) { for (const k of Object.keys(store)) delete store[k]; cb && cb(null, true); return this; },
    restoreItem(k, cb) { cb && cb(null, store[k] ?? null); return this; },
  });
  const button = (name) => { const b = { handlers: [], params: { text: "", is_visible: false, is_active: true }, isVisible: false,
    setText(t) { b.params.text = t; return b; }, setParams(p) { Object.assign(b.params, p); b.isVisible = !!b.params.is_visible; return b; },
    onClick(f) { b.handlers.push(f); return b; }, offClick(f) { b.handlers = b.handlers.filter((h) => h !== f); return b; },
    show() { b.params.is_visible = true; b.isVisible = true; return b; }, hide() { b.params.is_visible = false; b.isVisible = false; return b; },
    enable() { b.params.is_active = true; return b; }, disable() { b.params.is_active = false; return b; }, showProgress() { b.progress = true; return b; }, hideProgress() { b.progress = false; return b; } }; return b; };
  const Back = button("Back"), Main = button("Main"), Second = button("Second"), SettingsB = button("Settings");
  const WebApp = {
    initData, initDataUnsafe: { user, start_param: params.get("tgWebAppStartParam") || undefined, auth_date: 1, hash: "x" }, version, platform: params.get("tgWebAppPlatform") || "ios",
    colorScheme: "dark", themeParams: window.__themeParams || { bg_color: "#05070f" }, isActive: true, isExpanded: true, viewportHeight: innerHeight, viewportStableHeight: innerHeight,
    headerColor: "", backgroundColor: "", bottomBarColor: "", isClosingConfirmationEnabled: false, isVerticalSwipesEnabled: true, isFullscreen: false, isOrientationLocked: false,
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 }, contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    BackButton: Back, MainButton: Main, SecondaryButton: Second, SettingsButton: SettingsB,
    HapticFeedback: { impactOccurred(s) { log.push(["haptic", s]); }, notificationOccurred(t) { log.push(["haptic", t]); }, selectionChanged() { log.push(["haptic", "select"]); } },
    CloudStorage: mkStorage(cloud), DeviceStorage: mkStorage(device), SecureStorage: mkStorage(secureStore),
    BiometricManager: { isInited: false, isBiometricAvailable: true, biometricType: "face", isAccessRequested: false, isAccessGranted: false, isBiometricTokenSaved: false, deviceId: "d", init(cb) { this.isInited = true; cb && cb(); return this; }, requestAccess(p, cb) { this.isAccessGranted = true; cb && cb(true); return this; }, authenticate(p, cb) { cb && cb(true, "t"); return this; }, updateBiometricToken(t, cb) { cb && cb(true); return this; }, openSettings() { return this; } },
    Accelerometer: { isStarted: false, x: null, y: null, z: null, start(p, cb) { cb && cb(true); return this; }, stop(cb) { cb && cb(true); return this; } },
    Gyroscope: { isStarted: false, x: null, y: null, z: null, start(p, cb) { cb && cb(true); return this; }, stop(cb) { cb && cb(true); return this; } },
    DeviceOrientation: { isStarted: false, absolute: false, alpha: null, beta: null, gamma: null, start(p, cb) { cb && cb(true); return this; }, stop(cb) { cb && cb(true); return this; } },
    LocationManager: { isInited: false, isLocationAvailable: true, isAccessRequested: false, isAccessGranted: true, init(cb) { this.isInited = true; cb && cb(); return this; }, getLocation(cb) { cb({ latitude: 33.75, longitude: -84.39, altitude: null, course: null, speed: null, horizontal_accuracy: null, vertical_accuracy: null, course_accuracy: null, speed_accuracy: null }); return this; }, openSettings() { return this; } },
    isVersionAtLeast: atLeast, setHeaderColor(c) { WebApp.headerColor = c; log.push(["header", c]); }, setBackgroundColor(c) { WebApp.backgroundColor = c; }, setBottomBarColor(c) { WebApp.bottomBarColor = c; },
    enableClosingConfirmation() { WebApp.isClosingConfirmationEnabled = true; }, disableClosingConfirmation() { WebApp.isClosingConfirmationEnabled = false; },
    enableVerticalSwipes() { WebApp.isVerticalSwipesEnabled = true; }, disableVerticalSwipes() { WebApp.isVerticalSwipesEnabled = false; },
    requestFullscreen() { WebApp.isFullscreen = true; log.push(["fullscreen", true]); }, exitFullscreen() { WebApp.isFullscreen = false; }, lockOrientation() { WebApp.isOrientationLocked = true; }, unlockOrientation() { WebApp.isOrientationLocked = false; },
    addToHomeScreen() { log.push(["homescreen"]); }, checkHomeScreenStatus(cb) { cb && cb("missed"); },
    onEvent(e, cb) { (events[e] = events[e] || []).push(cb); }, offEvent(e, cb) { events[e] = (events[e] || []).filter((h) => h !== cb); }, sendData(d) { log.push(["sendData", d]); },
    switchInlineQuery(q, t) { log.push(["inline", q, t]); }, openLink(u) { log.push(["openLink", u]); }, openTelegramLink(u) { log.push(["openTelegramLink", u]); },
    openInvoice(u, cb) { log.push(["invoice", u]); cb && cb("paid"); }, shareToStory(m, p) { log.push(["story", m, p]); }, shareMessage(id, cb) { log.push(["shareMessage", id]); cb && cb(true); },
    setEmojiStatus(id, p, cb) { cb && cb(true); }, requestEmojiStatusAccess(cb) { cb && cb(true); }, downloadFile(p, cb) { log.push(["download", p.file_name]); cb && cb(true); },
    hideKeyboard() { document.activeElement && document.activeElement.blur(); }, showPopup(p, cb) { log.push(["popup", p]); popupCb = cb; }, showAlert(m, cb) { log.push(["alert", m]); cb && cb(); }, showConfirm(m, cb) { log.push(["confirm", m]); cb && cb(true); },
    showScanQrPopup(p, cb) { log.push(["qr"]); WebApp.__qr = cb; }, closeScanQrPopup() {}, readTextFromClipboard(cb) { cb && cb(WebApp.__clip ?? null); },
    requestWriteAccess(cb) { log.push(["writeAccess"]); cb && cb(true); }, requestContact(cb) { cb && cb(true); }, ready() { log.push(["ready"]); }, expand() { log.push(["expand"]); }, close() { log.push(["close"]); },
  };
  window.Telegram = { WebApp };
  window.__tg = {
    log, cloud, device, secure: secureStore,
    state() { return { main: Main.params.is_visible ? Main.params.text : null, second: Second.params.is_visible ? Second.params.text : null, back: Back.isVisible, settings: SettingsB.isVisible, header: WebApp.headerColor, swipes: WebApp.isVerticalSwipesEnabled, closing: WebApp.isClosingConfirmationEnabled }; },
    press(w) { const b = { back: Back, main: Main, second: Second, settings: SettingsB }[w]; b.handlers.forEach((h) => h()); },
    answerPopup(id) { const cb = popupCb; popupCb = null; cb && cb(id); },
    fire(e, ...a) { (events[e] || []).forEach((h) => h(...a)); },
  };
})();
