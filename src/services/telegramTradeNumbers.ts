export interface TelegramTradeNumber {
  tradeNumber: number;
  tradeDate: string;
}

export interface SentTelegramTradeState extends Partial<TelegramTradeNumber> {
  pending?: boolean;
  cancelled?: boolean;
  entry?: boolean;
  rf?: boolean;
  result?: 'tp' | 'sl';
}

export type SentTelegramAlerts = Record<string, SentTelegramTradeState>;

export function nepalTradeDate(nowSeconds: number): string {
  return new Date((nowSeconds + 5 * 3600 + 45 * 60) * 1000).toISOString().slice(0, 10);
}

function hasTradeNumber(state: SentTelegramTradeState | undefined): state is SentTelegramTradeState & TelegramTradeNumber {
  return Number.isSafeInteger(state?.tradeNumber) && state!.tradeNumber! > 0
    && typeof state?.tradeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.tradeDate);
}

// Called inside the server's existing serialized Telegram queue. Store this
// reservation before sending so retries and restarts retain the same number.
export function reserveTelegramTradeNumber(
  sent: SentTelegramAlerts,
  alertId: string,
  tradeKey = alertId,
  nowSeconds = Date.now() / 1000,
): TelegramTradeNumber & { changed: boolean } {
  const ownState = (key: string) => Object.hasOwn(sent, key) ? sent[key] : undefined;
  const existing = [ownState(tradeKey), ownState(alertId)].find(hasTradeNumber);
  const tradeDate = existing?.tradeDate ?? nepalTradeDate(nowSeconds);
  const tradeNumber = existing?.tradeNumber ?? 1 + Object.values(sent).reduce((maximum, state) => (
    hasTradeNumber(state) && state.tradeDate === tradeDate ? Math.max(maximum, state.tradeNumber) : maximum
  ), 0);
  let changed = false;
  for (const key of new Set([tradeKey, alertId])) {
    const state = ownState(key);
    if (state?.tradeNumber === tradeNumber && state.tradeDate === tradeDate) continue;
    Object.defineProperty(sent, key, {
      value: { ...state, tradeNumber, tradeDate }, enumerable: true, writable: true, configurable: true,
    });
    changed = true;
  }
  return { tradeNumber, tradeDate, changed };
}

export function telegramTradeNumberLabel(number: TelegramTradeNumber): string {
  return `Trade #${number.tradeNumber} | ${number.tradeDate} (Nepal)`;
}
