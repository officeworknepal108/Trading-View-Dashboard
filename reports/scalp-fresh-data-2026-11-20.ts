// Read public market candles and write research snapshots only; no trading calls.
import fs from 'node:fs';
import { fetchTradingViewCandles } from '../src/services/tradingViewDatafeed';
const root=new URL('./',import.meta.url),stem='scalp-fresh-data-2026-11-20';
const requests=[['M1',5000],['M15',5000],['H1',1500],['H4',700]] as const;
const results=await Promise.allSettled(requests.map(async([tf,count])=>{
  const candles=await fetchTradingViewCandles({symbol:'XAUUSD',exchange:'OANDA',granularity:tf,count,timeoutMs:25000});
  const metadata={timeframe:tf,count:candles.length,firstUTC:new Date(candles[0].time*1000).toISOString(),lastUTC:new Date(candles.at(-1)!.time*1000).toISOString(),lastComplete:candles.at(-1)!.complete};
  fs.writeFileSync(new URL(`${stem}-${tf}.json`,root),JSON.stringify(candles)+'\n');
  console.log(JSON.stringify(metadata));return metadata;
}));
const summary={source:'TradingView OANDA:XAUUSD',fetchedUTC:new Date().toISOString(),results:results.map((r,i)=>r.status==='fulfilled'?{ok:true,...r.value}:{ok:false,timeframe:requests[i][0],error:String(r.reason)})};
fs.writeFileSync(new URL(`${stem}-coverage.json`,root),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
