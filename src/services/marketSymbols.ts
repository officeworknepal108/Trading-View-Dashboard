export const OANDA_MARKET_SYMBOLS = [
  'XAUUSD',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'AUDUSD',
  'USDCAD',
] as const;

export type OandaMarketSymbol = typeof OANDA_MARKET_SYMBOLS[number];

export interface OandaMarketSymbolConfig {
  symbol: OandaMarketSymbol;
  displayName: string;
  shortName: string;
  base: string;
  quote: string;
  pricePrecision: number;
  minMove: number;
  pipSize: number;
  mt5AutomationEnabled: boolean;
}

export const OANDA_MARKET_SYMBOL_CONFIG: Record<OandaMarketSymbol, OandaMarketSymbolConfig> = {
  XAUUSD: {
    symbol: 'XAUUSD', displayName: 'Gold Spot / U.S. Dollar', shortName: 'XAU/USD',
    base: 'XAU', quote: 'USD', pricePrecision: 3, minMove: 0.001, pipSize: 0.1,
    mt5AutomationEnabled: true,
  },
  EURUSD: {
    symbol: 'EURUSD', displayName: 'Euro / U.S. Dollar', shortName: 'EUR/USD',
    base: 'EUR', quote: 'USD', pricePrecision: 5, minMove: 0.00001, pipSize: 0.0001,
    mt5AutomationEnabled: false,
  },
  GBPUSD: {
    symbol: 'GBPUSD', displayName: 'British Pound / U.S. Dollar', shortName: 'GBP/USD',
    base: 'GBP', quote: 'USD', pricePrecision: 5, minMove: 0.00001, pipSize: 0.0001,
    mt5AutomationEnabled: false,
  },
  USDJPY: {
    symbol: 'USDJPY', displayName: 'U.S. Dollar / Japanese Yen', shortName: 'USD/JPY',
    base: 'USD', quote: 'JPY', pricePrecision: 3, minMove: 0.001, pipSize: 0.01,
    mt5AutomationEnabled: false,
  },
  AUDUSD: {
    symbol: 'AUDUSD', displayName: 'Australian Dollar / U.S. Dollar', shortName: 'AUD/USD',
    base: 'AUD', quote: 'USD', pricePrecision: 5, minMove: 0.00001, pipSize: 0.0001,
    mt5AutomationEnabled: false,
  },
  USDCAD: {
    symbol: 'USDCAD', displayName: 'U.S. Dollar / Canadian Dollar', shortName: 'USD/CAD',
    base: 'USD', quote: 'CAD', pricePrecision: 5, minMove: 0.00001, pipSize: 0.0001,
    mt5AutomationEnabled: false,
  },
};

export function normalizeOandaMarketSymbol(value: unknown): OandaMarketSymbol | undefined {
  const normalized = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return OANDA_MARKET_SYMBOLS.find((symbol) => symbol === normalized);
}

export function oandaMarketSymbolConfig(symbol: OandaMarketSymbol): OandaMarketSymbolConfig {
  return OANDA_MARKET_SYMBOL_CONFIG[symbol];
}
