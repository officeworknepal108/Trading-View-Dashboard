export const INDICATOR_FIB_LEVELS = [
  { ratio: 0, label: '0' },
  { ratio: 0.5, label: '0.5' },
  { ratio: 0.618, label: '0.618' },
  { ratio: 0.71, label: '0.71' },
  { ratio: 0.79, label: '0.79' },
  { ratio: 1, label: '1' },
] as const;

/**
 * The indicator anchors level 1 at the originating structure price and level 0
 * at the completed move extreme.
 */
export function indicatorFibPrice(zeroPrice: number, sourcePrice: number, ratio: number): number {
  return zeroPrice + (sourcePrice - zeroPrice) * ratio;
}
