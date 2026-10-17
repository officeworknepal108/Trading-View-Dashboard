import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OANDA_MARKET_SYMBOLS,
  normalizeOandaMarketSymbol,
  oandaMarketSymbolConfig,
} from '../src/services/marketSymbols';

test('OANDA market list contains gold and the five requested currency pairs', () => {
  assert.deepEqual(OANDA_MARKET_SYMBOLS, [
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
  ]);
});

test('OANDA symbols normalize common pair notation and reject unsupported markets', () => {
  assert.equal(normalizeOandaMarketSymbol('eur/usd'), 'EURUSD');
  assert.equal(normalizeOandaMarketSymbol(' USD-JPY '), 'USDJPY');
  assert.equal(normalizeOandaMarketSymbol('NZDUSD'), undefined);
});

test('currency pairs expose the correct pip and price precision without enabling MT5 automation', () => {
  assert.equal(oandaMarketSymbolConfig('EURUSD').pipSize, 0.0001);
  assert.equal(oandaMarketSymbolConfig('EURUSD').pricePrecision, 5);
  assert.equal(oandaMarketSymbolConfig('USDJPY').pipSize, 0.01);
  assert.equal(oandaMarketSymbolConfig('USDJPY').pricePrecision, 3);
  assert.equal(oandaMarketSymbolConfig('USDJPY').mt5AutomationEnabled, false);
  assert.equal(oandaMarketSymbolConfig('XAUUSD').mt5AutomationEnabled, true);
});
