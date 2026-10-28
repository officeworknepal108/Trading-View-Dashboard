export interface TelegramTradeNumber {
  tradeNumber: number;
  tradeDate: string;
}

export interface SentTelegramTradeState extends Partial<TelegramTradeNumber> {
  summarySent?: boolean;
  pending?: boolean;
  cancelled?: boolean;
  entry?: boolean;
  rf?: boolean;
  result?: 'tp' | 'sl';
}

export type SentTelegramAlerts = Record<string, SentTelegramTradeState>;

/** Preserve delivery evidence from the old account-specific histories. */
export function mergeTelegramAlertHistories(histories: SentTelegramAlerts[]): SentTelegramAlerts {
  const merged: SentTelegramAlerts = Object.create(null);
  for (const history of histories) {
    for (const [key, state] of Object.entries(history)) {
      const previous = merged[key];
      const numbered = [previous, state].filter(hasTradeNumber).sort((a, b) => (
        a.tradeDate.localeCompare(b.tradeDate) || a.tradeNumber - b.tradeNumber
      ))[0];
      merged[key] = {
        ...previous, ...state, ...numbered,
        summarySent: previous?.summarySent || state.summarySent,
        pending: previous?.pending || state.pending,
        cancelled: previous?.cancelled || state.cancelled,
        entry: previous?.entry || state.entry,
        rf: previous?.rf || state.rf,
        result: previous?.result ?? state.result,
      };
    }
  }
  return merged;
}

/** Signal identity stays fixed when the broker fills at a different price. */
export function telegramSignalKey(id: string): string {
  return id.replace(/^([A-Z0-9]{3,12}:(?:bullish|bearish):(?:M1|M5|M15|M30|H1|H4|D):\d+):\d+(?:\.\d+)?$/, '$1');
}

export function bindTelegramAlertAliases(sent: SentTelegramAlerts, id: string, tradeKey = id): string[] {
  const key = telegramSignalKey(tradeKey);
  const aliases = [...new Set([key, tradeKey, id, ...Object.keys(sent).filter(candidate => (
    telegramSignalKey(candidate) === key
  ))])];
  const states = aliases.map(alias => Object.hasOwn(sent, alias) ? sent[alias] : undefined)
    .filter((state): state is SentTelegramTradeState => state !== undefined);
  const numbered = states.filter(hasTradeNumber).sort((a, b) => (
    a.tradeDate.localeCompare(b.tradeDate) || a.tradeNumber - b.tradeNumber
  ))[0];
  const merged: SentTelegramTradeState = {
    ...numbered,
    pending: states.some(state => state.pending),
    cancelled: states.some(state => state.cancelled),
    entry: states.some(state => state.entry),
    rf: states.some(state => state.rf),
    result: states.find(state => state.result)?.result,
  };
  for (const alias of aliases) Object.defineProperty(sent, alias, {
    value: merged, enumerable: true, configurable: true, writable: true,
  });
  return aliases;
}

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
