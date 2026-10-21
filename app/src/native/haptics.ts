import type * as CapacitorHaptics from "@capacitor/haptics";

export type HapticKind = "tap" | "select" | "success" | "warning" | "error" | "heavy";

/**
 * The haptic kinds the screens ask for, played by the iOS/Android build's own Taptic Engine or
 * vibrator, the way Telegram's HapticFeedback plays them and Bible Strong's expo-haptics calls do.
 * The plugin loads straight away, so the first tap does not wait for it.
 */
export function nativeHaptics(load: () => Promise<typeof CapacitorHaptics>) {
  // Selection feedback only plays between selectionStart and selectionEnd, so it is started once.
  const ready = load().then((m) => m.Haptics.selectionStart().then(() => m, () => m));
  return (kind: HapticKind) => {
    void ready.then(({ Haptics, ImpactStyle, NotificationType }) => {
      if (kind === "select") return Haptics.selectionChanged();
      if (kind === "success") return Haptics.notification({ type: NotificationType.Success });
      if (kind === "warning") return Haptics.notification({ type: NotificationType.Warning });
      if (kind === "error") return Haptics.notification({ type: NotificationType.Error });
      return Haptics.impact({ style: kind === "heavy" ? ImpactStyle.Medium : ImpactStyle.Light });
    }).catch(() => undefined);
  };
}
