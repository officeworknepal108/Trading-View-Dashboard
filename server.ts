import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { fetchTradingViewCandles } from './src/services/tradingViewDatafeed';

const GRANULARITIES = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D', 'W', 'MO']);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      service: 'tradingview-oanda-candle-dashboard',
      provider: 'TradingView WebSocket',
      symbol: 'OANDA:XAUUSD',
      authentication: 'unauthorized_user_token',
      unofficial: true,
      fallbackEnabled: false,
    });
  });

  app.get('/api/tradingview/market-data', async (req, res) => {
    try {
      const granularity = String(req.query.granularity || 'H1').toUpperCase();
      const count = Math.max(10, Math.min(Number(req.query.count || 1500), 5000));
      const requestedEndTime = Number(req.query.endTime);
      const endTime = Number.isFinite(requestedEndTime) && requestedEndTime > 0
        ? Math.floor(requestedEndTime)
        : undefined;
      if (!GRANULARITIES.has(granularity)) {
        return res.status(400).json({ ok: false, error: 'Unsupported candle granularity.' });
      }

      const candles = await fetchTradingViewCandles({
        exchange: 'OANDA', symbol: 'XAUUSD', granularity, count, endTime,
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        ok: true,
        provider: 'TradingView WebSocket',
        source: 'TradingView WebSocket · OANDA:XAUUSD · unofficial',
        unofficial: true,
        exchange: 'OANDA',
        symbol: 'XAUUSD',
        granularity,
        fetchedAt: new Date().toISOString(),
        count: candles.length,
        candles,
      });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        provider: 'TradingView WebSocket',
        unofficial: true,
        error: error instanceof Error ? error.message : 'Unknown TradingView data error.',
      });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'API route not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`TradingView OANDA Candle Dashboard running on http://localhost:${port}`);
  });
}

void startServer();
