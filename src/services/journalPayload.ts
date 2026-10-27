interface JournalMedia {
  id: string;
  screenshotDataUrl?: unknown;
  entryScreenshotDataUrl?: unknown;
  exitScreenshotDataUrl?: unknown;
  snapshotCandles?: unknown;
  entrySnapshotCandles?: unknown;
  exitSnapshotCandles?: unknown;
  mt5Managed?: unknown;
  mt5SignalId?: unknown;
  lifecycleStatus?: unknown;
}

/** Chart calculations need trade facts, not the journal's image archive. */
export function journalDashboardTrades<T extends JournalMedia>(trades: T[]) {
  return trades.map(({
    screenshotDataUrl, entryScreenshotDataUrl, exitScreenshotDataUrl,
    snapshotCandles, entrySnapshotCandles, exitSnapshotCandles, ...facts
  }) => facts);
}

export function journalPendingImageTrades<T extends JournalMedia>(trades: T[]): T[] {
  return trades.filter((trade) => trade.mt5Managed && trade.mt5SignalId
    && (!trade.entryScreenshotDataUrl
      || (trade.lifecycleStatus === 'closed' && !trade.exitScreenshotDataUrl)));
}
