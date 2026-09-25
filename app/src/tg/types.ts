/**
 * The Telegram Mini App API (window.Telegram.WebApp) as of Bot API 9.x, typed for what the
 * app uses. Every feature is gated at the call site by `WebApp.isVersionAtLeast`, so the app
 * runs on any client and simply has less to offer on an old one.
 * https://core.telegram.org/bots/webapps
 */
export type Cb = () => void;

export type ThemeParams = {
  bg_color?: string; text_color?: string; hint_color?: string; link_color?: string; button_color?: string; button_text_color?: string;
  secondary_bg_color?: string; header_bg_color?: string; bottom_bar_bg_color?: string; accent_text_color?: string; section_bg_color?: string;
  section_header_text_color?: string; section_separator_color?: string; subtitle_text_color?: string; destructive_text_color?: string;
};
export type Insets = { top: number; bottom: number; left: number; right: number };
export type WebAppUser = { id: number; is_bot?: boolean; first_name: string; last_name?: string; username?: string; language_code?: string; is_premium?: boolean; added_to_attachment_menu?: boolean; allows_write_to_pm?: boolean; photo_url?: string };
export type WebAppChat = { id: number; type: "group" | "supergroup" | "channel"; title: string; username?: string; photo_url?: string };
export type InitDataUnsafe = { query_id?: string; user?: WebAppUser; receiver?: WebAppUser; chat?: WebAppChat; chat_type?: "sender" | "private" | "group" | "supergroup" | "channel"; chat_instance?: string; start_param?: string; can_send_after?: number; auth_date: number; hash: string; signature?: string };

export type BottomButtonParams = { text?: string; color?: string; text_color?: string; has_shine_effect?: boolean; position?: "left" | "right" | "top" | "bottom"; is_active?: boolean; is_visible?: boolean };
export type BottomButton = {
  readonly text: string; readonly color: string; readonly textColor: string; readonly isVisible: boolean; readonly isActive: boolean; readonly hasShineEffect: boolean; readonly isProgressVisible: boolean;
  setText(t: string): BottomButton; onClick(cb: Cb): BottomButton; offClick(cb: Cb): BottomButton; show(): BottomButton; hide(): BottomButton; enable(): BottomButton; disable(): BottomButton;
  showProgress(leaveActive?: boolean): BottomButton; hideProgress(): BottomButton; setParams(p: BottomButtonParams): BottomButton;
};
export type SimpleButton = { readonly isVisible: boolean; onClick(cb: Cb): SimpleButton; offClick(cb: Cb): SimpleButton; show(): SimpleButton; hide(): SimpleButton };
export type PopupButton = { id?: string; type?: "default" | "ok" | "close" | "cancel" | "destructive"; text?: string };
export type PopupParams = { title?: string; message: string; buttons?: PopupButton[] };
export type ScanQrPopupParams = { text?: string };
export type StoryWidgetLink = { url: string; name?: string };
export type StoryShareParams = { text?: string; widget_link?: StoryWidgetLink };
export type ShareMessageCb = (sent: boolean) => void;
export type EmojiStatusParams = { duration?: number };
export type DownloadFileParams = { url: string; file_name: string };
export type InvoiceStatus = "paid" | "cancelled" | "failed" | "pending";
export type HomeScreenStatus = "unsupported" | "unknown" | "added" | "missed";
export type SafeAreaSet = { safeAreaInset: Insets; contentSafeAreaInset: Insets };

export type Storage = {
  setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): Storage;
  getItem(key: string, cb: (err: string | null, value?: string) => void): Storage;
  getItems(keys: string[], cb: (err: string | null, values?: Record<string, string>) => void): Storage;
  removeItem(key: string, cb?: (err: string | null, ok?: boolean) => void): Storage;
  removeItems(keys: string[], cb?: (err: string | null, ok?: boolean) => void): Storage;
  getKeys(cb: (err: string | null, keys?: string[]) => void): Storage;
};
export type DeviceStorage = { setItem: Storage["setItem"]; getItem: Storage["getItem"]; removeItem: Storage["removeItem"]; clear(cb?: (err: string | null, ok?: boolean) => void): DeviceStorage };
export type SecureStorage = DeviceStorage & { restoreItem(key: string, cb?: (err: string | null, value?: string | null) => void): SecureStorage };

export type BiometricManager = {
  readonly isInited: boolean; readonly isBiometricAvailable: boolean; readonly biometricType: "finger" | "face" | "unknown"; readonly isAccessRequested: boolean; readonly isAccessGranted: boolean; readonly isBiometricTokenSaved: boolean; readonly deviceId: string;
  init(cb?: Cb): BiometricManager; requestAccess(p: { reason?: string }, cb?: (granted: boolean) => void): BiometricManager;
  authenticate(p: { reason?: string }, cb?: (ok: boolean, token?: string) => void): BiometricManager; updateBiometricToken(token: string, cb?: (ok: boolean) => void): BiometricManager; openSettings(): BiometricManager;
};
export type Sensor = { readonly isStarted: boolean; readonly x: number | null; readonly y: number | null; readonly z: number | null; start(p: { refresh_rate?: number }, cb?: (ok: boolean) => void): Sensor; stop(cb?: (ok: boolean) => void): Sensor };
export type Orientation = { readonly isStarted: boolean; readonly absolute: boolean; readonly alpha: number | null; readonly beta: number | null; readonly gamma: number | null; start(p: { refresh_rate?: number; need_absolute?: boolean }, cb?: (ok: boolean) => void): Orientation; stop(cb?: (ok: boolean) => void): Orientation };
export type LocationData = { latitude: number; longitude: number; altitude: number | null; course: number | null; speed: number | null; horizontal_accuracy: number | null; vertical_accuracy: number | null; course_accuracy: number | null; speed_accuracy: number | null };
export type LocationManager = {
  readonly isInited: boolean; readonly isLocationAvailable: boolean; readonly isAccessRequested: boolean; readonly isAccessGranted: boolean;
  init(cb?: Cb): LocationManager; getLocation(cb: (data: LocationData | null) => void): LocationManager; openSettings(): LocationManager;
};

export type WebApp = {
  initData: string; initDataUnsafe: InitDataUnsafe; version: string; platform: string; colorScheme: "light" | "dark"; themeParams: ThemeParams;
  isActive: boolean; isExpanded: boolean; viewportHeight: number; viewportStableHeight: number; headerColor: string; backgroundColor: string; bottomBarColor: string;
  isClosingConfirmationEnabled: boolean; isVerticalSwipesEnabled: boolean; isFullscreen: boolean; isOrientationLocked: boolean; safeAreaInset: Insets; contentSafeAreaInset: Insets;
  BackButton: SimpleButton; MainButton: BottomButton; SecondaryButton: BottomButton; SettingsButton: SimpleButton;
  HapticFeedback: { impactOccurred(s: "light" | "medium" | "heavy" | "rigid" | "soft"): void; notificationOccurred(t: "error" | "success" | "warning"): void; selectionChanged(): void };
  CloudStorage: Storage; DeviceStorage: DeviceStorage; SecureStorage: SecureStorage; BiometricManager: BiometricManager;
  Accelerometer: Sensor; DeviceOrientation: Orientation; Gyroscope: Sensor; LocationManager: LocationManager;
  isVersionAtLeast(v: string): boolean; setHeaderColor(c: string): void; setBackgroundColor(c: string): void; setBottomBarColor(c: string): void;
  enableClosingConfirmation(): void; disableClosingConfirmation(): void; enableVerticalSwipes(): void; disableVerticalSwipes(): void;
  requestFullscreen(): void; exitFullscreen(): void; lockOrientation(): void; unlockOrientation(): void; addToHomeScreen(): void; checkHomeScreenStatus(cb?: (s: HomeScreenStatus) => void): void;
  onEvent(e: string, cb: (...a: never[]) => void): void; offEvent(e: string, cb: (...a: never[]) => void): void; sendData(data: string): void;
  switchInlineQuery(query: string, chooseChatTypes?: ("users" | "bots" | "groups" | "channels")[]): void; openLink(url: string, o?: { try_instant_view?: boolean; try_browser?: string }): void; openTelegramLink(url: string): void;
  openInvoice(url: string, cb?: (status: InvoiceStatus) => void): void; shareToStory(mediaUrl: string, p?: StoryShareParams): void; shareMessage(msgId: string, cb?: ShareMessageCb): void;
  setEmojiStatus(customEmojiId: string, p?: EmojiStatusParams, cb?: (ok: boolean) => void): void; requestEmojiStatusAccess(cb?: (ok: boolean) => void): void; downloadFile(p: DownloadFileParams, cb?: (accepted: boolean) => void): void;
  hideKeyboard(): void; showPopup(p: PopupParams, cb?: (id?: string) => void): void; showAlert(msg: string, cb?: Cb): void; showConfirm(msg: string, cb?: (ok: boolean) => void): void;
  showScanQrPopup(p: ScanQrPopupParams, cb?: (text: string) => boolean | void): void; closeScanQrPopup(): void; readTextFromClipboard(cb?: (text: string | null) => void): void;
  requestWriteAccess(cb?: (ok: boolean) => void): void; requestContact(cb?: (ok: boolean) => void): void; ready(): void; expand(): void; close(): void;
};

declare global {
  interface Window { Telegram?: { WebApp?: WebApp } }
}
