/** Bible Strong's text scaling (BibleDOM/scaleFontSize, scaleLineHeight, verseTypography). */
export const scaleFontSize = (value: number, scale: number) => `${value + scale * 0.1 * value}px`;
export const scaleFontSizeNumber = (value: number, scale: number) => value + scale * 0.1 * value;
export function scaleLineHeight(value: number, type: "small" | "normal" | "large", fontSizeScale: number): string {
  const scaled = value + fontSizeScale * 0.1 * value;
  const k = { small: 0.8, normal: 1.1, large: 1.4 }[type];
  return `${Math.round(scaled * k)}px`;
}
export const getBibleTextFontSize = (isParallel: boolean, fontSizeScale: number) => scaleFontSize(isParallel ? 16 : 19, fontSizeScale);
