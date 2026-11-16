/** New setups allow 75 minutes from confirmation; saved v1/v2 orders keep their original deadline. */
export const PULLBACK_EXPIRY_SECONDS = 75 * 60;
export function pullbackExpirySeconds(version: number, candleSeconds: number): number {
  return version >= 3 ? PULLBACK_EXPIRY_SECONDS : candleSeconds;
}
