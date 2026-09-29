import WebSocket, { RawData } from 'ws';

export interface TradingViewCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  complete: boolean;
}

const TRADINGVIEW_SOCKET = 'wss://data.tradingview.com/socket.io/websocket';

const RESOLUTIONS: Record<string, string> = {
  M1: '1', M5: '5', M15: '15', M30: '30', H1: '60', H4: '240', D: '1D', W: '1W',
};

function packet(method: string, params: unknown[]): string {
  const body = JSON.stringify({ m: method, p: params });
  return `~m~${body.length}~m~${body}`;
}

function parseMessages(raw: string): unknown[] {
  const messages: unknown[] = [];
  const marker = /~m~(\d+)~m~/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw)) !== null) {
    const length = Number(match[1]);
    const start = marker.lastIndex;
    const body = raw.slice(start, start + length);
    if (body.startsWith('{')) {
      try { messages.push(JSON.parse(body)); } catch { /* Ignore incomplete frames. */ }
    }
    marker.lastIndex = start + length;
  }
  return messages;
}

function randomSession(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

export async function fetchTradingViewCandles(options: {
  symbol?: string;
  exchange?: string;
  granularity?: string;
  count?: number;
  endTime?: number;
  timeoutMs?: number;
} = {}): Promise<TradingViewCandle[]> {
  const symbol = (options.symbol || 'XAUUSD').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const exchange = (options.exchange || 'OANDA').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const granularity = (options.granularity || 'H1').toUpperCase();
  const resolution = RESOLUTIONS[granularity];
  if (!resolution) throw new Error(`Unsupported TradingView granularity: ${granularity}`);

  const count = Math.max(10, Math.min(Number(options.count || 1500), 5000));
  const endTime = Number.isFinite(options.endTime) ? Math.floor(Number(options.endTime)) : undefined;
  const timeoutMs = Math.max(3_000, options.timeoutMs || (endTime === undefined ? 12_000 : 45_000));
  const fullSymbol = `${exchange}:${symbol}`;
  const chartSession = randomSession('cs');

  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const candlesByTime = new Map<number, TradingViewCandle>();
    let earliestSeen = Number.POSITIVE_INFINITY;
    let historyRequests = 0;
    const pageSize = Math.max(count, 5000);
    const maxHistoryRequests = 100;
    const socket = new WebSocket(TRADINGVIEW_SOCKET, {
      headers: {
        Origin: 'https://data.tradingview.com',
        Referer: 'https://www.tradingview.com/',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    const finish = (error?: Error, candles?: TradingViewCandle[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close();
      if (error) reject(error);
      else resolve(candles || []);
    };

    const timer = setTimeout(
      () => finish(new Error(`TradingView timed out while loading ${fullSymbol}.`)),
      timeoutMs,
    );

    socket.on('open', () => {
      socket.send(packet('set_auth_token', ['unauthorized_user_token']));
      socket.send(packet('chart_create_session', [chartSession, '']));
      const specification = `={"symbol":"${fullSymbol}","adjustment":"splits","session":"regular"}`;
      socket.send(packet('resolve_symbol', [chartSession, 'symbol_1', specification]));
      socket.send(packet('create_series', [
        chartSession, 's1', 's1', 'symbol_1', resolution,
        endTime === undefined ? count : pageSize, '',
      ]));
    });

    socket.on('message', (data: RawData) => {
      const text = data.toString();
      buffer += text;
      for (const framed of text.match(/~m~\d+~m~(~h~\d+)/g) || []) {
        const heartbeat = framed.replace(/^~m~\d+~m~/, '');
        socket.send(`~m~${heartbeat.length}~m~${heartbeat}`);
      }

      const messages = parseMessages(buffer) as Array<{ m?: string; p?: any[] }>;
      if (messages.length > 0) buffer = '';
      for (const message of messages) {
        if (message.m === 'series_completed' && endTime !== undefined
          && message.p?.[4]?.data_completed === 'limit' && candlesByTime.size > 0) {
          finish(new Error(`TradingView's available ${granularity} history does not reach ${new Date(endTime * 1000).toISOString()}.`));
          return;
        }
        if (message.m === 'critical_error' || message.m === 'symbol_error') {
          finish(new Error(`TradingView rejected ${fullSymbol}.`));
          return;
        }
        if (message.m !== 'timescale_update') continue;
        const rows = message.p?.[1]?.s1?.s;
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const receivedCandles = rows
          .map((row: any): TradingViewCandle | null => {
            const value = row?.v;
            if (!Array.isArray(value) || value.length < 5) return null;
            const candle: TradingViewCandle = {
              time: Math.floor(Number(value[0])),
              open: Number(value[1]), high: Number(value[2]), low: Number(value[3]), close: Number(value[4]),
              volume: Number(value[5] || 0), complete: true,
            };
            return [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume]
              .every(Number.isFinite) ? candle : null;
          })
          .filter((candle: TradingViewCandle | null): candle is TradingViewCandle => candle !== null)
          .sort((a: TradingViewCandle, b: TradingViewCandle) => a.time - b.time);
        if (receivedCandles.length === 0) continue;
        for (const candle of receivedCandles) candlesByTime.set(candle.time, candle);
        const candles = [...candlesByTime.values()].sort((a, b) => a.time - b.time);

        if (endTime === undefined) {
          candles[candles.length - 1].complete = false;
          finish(undefined, candles.slice(-count));
          return;
        }

        const newEarliest = candles[0].time;
        let replayIndex = -1;
        for (let index = candles.length - 1; index >= 0; index -= 1) {
          if (candles[index].time <= endTime) {
            replayIndex = index;
            break;
          }
        }
        if (replayIndex >= 0) {
          // Keep history for structure calculations and a matching amount of
          // future data so candle-by-candle Replay can continue after a switch.
          const from = Math.max(0, replayIndex - count + 1);
          const to = Math.min(candles.length, replayIndex + count + 1);
          finish(undefined, candles.slice(from, to).map((candle) => ({ ...candle, complete: true })));
          return;
        }

        if (newEarliest < earliestSeen) {
          earliestSeen = newEarliest;
          if (historyRequests >= maxHistoryRequests) {
            finish(new Error(`TradingView history limit was reached before ${new Date(endTime * 1000).toISOString()}.`));
            return;
          }
          historyRequests += 1;
          socket.send(packet('request_more_data', [chartSession, 's1', pageSize]));
        }
      }
    });

    socket.on('error', (error) => finish(new Error(`TradingView WebSocket error: ${error.message}`)));
    socket.on('close', () => {
      if (!settled) finish(new Error(`TradingView closed before sending ${fullSymbol} candles.`));
    });
  });
}
