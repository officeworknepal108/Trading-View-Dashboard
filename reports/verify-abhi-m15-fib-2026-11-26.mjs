// Isolated built dashboard + real captured candles. Every API is mocked; no live trading access.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/abhi-m15-fib-path-2026-11-25.json', 'utf8'));
const stale = fixture.cases.flatMap(c => [10, 25].map(leg => {
  const sign = c.signal.direction === 'BUY' ? 1 : -1;
  const entry = c.signal.scalpEntry.confirmationClose - sign * c.signal.scalpEntry.confirmationBody * leg / 100;
  return { id: `SCALP_1_1:CHART:${c.signal.signalAt}:P${leg}`, setupId: `SCALP_1_1:${c.signal.signalAt}:P${leg}`,
    symbol: 'XAUUSD', zoneName: 'Abhi Scalp Logic', zoneTimeframe: 'M15', source: 'ENGULFING', tradeStyle: 'SCALP_1_1',
    signalAt: c.signal.signalAt, openedAt: c.record.confirmedAt, completedAt: c.record.confirmedAt + 2700,
    signalTimeframe: 'M15', engulfingType: c.record.signal.type, direction: c.record.signal.direction,
    entry, stopLoss: c.signal.stopLoss, takeProfit: entry + sign * Math.abs(entry - c.signal.stopLoss) * 1.25,
    riskPips: Math.abs(entry - c.signal.stopLoss) * 10, rewardRisk: 1.25,
    scalpEntry: { ...c.signal.scalpEntry, leg, riskShare: leg === 10 ? .4 : .6 }, result: c.time === '08:30' ? 'tp' : 'sl' };
}));
const blockedTimes = fixture.cases.filter(c => c.blocked).map(c => c.signal.signalAt);
const root = path.resolve('dist');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] ?? 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'abhi-fib-dashboard-'));
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(portFile) && i < 100; i++) await pause(100);
  assert.ok(fs.existsSync(portFile), 'Headless browser unavailable');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const fixture=${JSON.stringify(fixture)}, stale=${JSON.stringify(stale)};
    const originalFetch=window.fetch.bind(window);window.__apiCalls=[];
    window.fetch=async(input,options)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(!url.pathname.startsWith('/api/'))return originalFetch(input,options);
      if(window.__apiCalls.length<50)window.__apiCalls.push(url.pathname+url.search);
      if(url.pathname==='/api/auth/me')return Response.json({user:{id:'abhi-fib-test',username:'Isolated test',role:'admin',status:'approved',verified:true,createdAt:1,canAccess:true}});
      if(url.pathname.includes('market-data')){
        const tf=url.searchParams.get('granularity')||url.searchParams.get('timeframe')||'M15';
        return Response.json({ok:true,symbol:'XAUUSD',candles:fixture.candles[tf]||[],source:'TradingView OANDA captured test candles'});
      }
      if(url.pathname.includes('/journal/trades'))return Response.json({ok:true,trades:stale});
      if(url.pathname==='/api/mt5/status')return Response.json({ok:true,bridge:{connected:false},positions:[],recentSignals:[],config:{enabled:false,scalpingEnabled:false,intradayEnabled:false,scalpOneToOneEnabled:false,bollingerM5Enabled:false,telegramMessagesEnabled:false}});
      return Response.json({ok:false,error:'Isolated browser verification'});
    };
    const NativeWorker=window.Worker; window.__workerSeq=0;window.__scalpScan=null;
    window.Worker=class extends NativeWorker {
      constructor(url,options){super(url,options);this.__scalp=String(url).includes('scalpOneToOne.worker');
        if(this.__scalp){this.__id=++window.__workerSeq;window.__activeScalpWorker=this.__id;
          this.addEventListener('message',e=>{if(this.__id===window.__activeScalpWorker&&e.data.taskId===this.__task&&e.data.records)window.__scalpScan=e.data;});}}
      postMessage(data,...rest){if(this.__scalp){this.__task=data.taskId;window.__scalpScan=null;window.__scalpInput=Object.fromEntries(Object.entries(data.input?.candles||{}).map(([k,v])=>[k,v?.length||0]));}return super.postMessage(data,...rest);}
    };
  ` });
  await call('Emulation.setDeviceMetricsOverride', { width: 1900, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  const click = title => evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.title===${JSON.stringify(title)}||e.textContent.trim()===${JSON.stringify(title)});if(!e)throw Error('Missing button '+${JSON.stringify(title)});e.click()})()`);
  for (let i = 0; i < 150; i++) { if (await evaluate("!![...document.querySelectorAll('button')].find(e=>e.title==='Show indicator controls')")) break; await pause(100); }
  await click('Show indicator controls');
  await click('Show or hide completed engulfing SL, RF, TP, total, and accuracy results');
  await evaluate(`document.querySelectorAll('fieldset[aria-label="Accuracy strategies"] input').forEach((input,i)=>{if(input.checked!==(i===1))input.click()})`);
  const waitScan = async () => {
    for (let i = 0; i < 1800; i++) { if (await evaluate('!!window.__scalpScan && !window.__scalpScan.error && window.__scalpScan.fills.length>0')) return; await pause(100); }
    throw Error('Filtered worker scan timed out: '+JSON.stringify(await evaluate('({input:window.__scalpInput,scan:window.__scalpScan,calls:window.__apiCalls})')));
  };
  const checkScan = async (checkStatus = true) => {
    const result = await evaluate('({now:window.__scalpScan.now,records:window.__scalpScan.records.map(r=>({id:r.id,signalAt:r.signalAt,result:r.result})),fills:window.__scalpScan.fills.map(r=>({id:r.id,signalAt:r.trade.signal.time}))})');
    assert.ok(result.fills.length > 0, 'Need actual eligible entry fills to verify the worker');
    assert.ok(result.records.every(r => !blockedTimes.includes(r.signalAt)));
    assert.ok(result.fills.every(r => !blockedTimes.includes(r.signalAt)));
    if (checkStatus) assert.ok(await evaluate("document.body.innerText.includes('M15 Fib-zone entry filter')"));
    return result;
  };
  await waitScan();
  const live = await checkScan();
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`Number(document.querySelector('[title="Close accuracy table"]').closest('[data-journal-exclude]').innerText.match(/trade accuracy · (\\d+) setup/i)?.[1]) > 0`)) break;
    await pause(100);
  }
  const diagnostic = await evaluate(`({scanRecords:window.__scalpScan.records.length,scanFills:window.__scalpScan.fills.length,accuracy:document.querySelector('[title="Close accuracy table"]').closest('[data-journal-exclude]').innerText,strategies:[...document.querySelectorAll('fieldset[aria-label="Accuracy strategies"] label')].map(l=>({text:l.innerText,checked:l.querySelector('input').checked}))})`);
  fs.writeFileSync('reports/abhi-m15-fib-browser-diagnostic-2026-11-26.json', JSON.stringify(diagnostic,null,2));
  await evaluate(`document.querySelector('[aria-label="Entry arrow options"]').click()`);
  await evaluate(`(()=>{const input=document.querySelector('[aria-label="Show entry arrows"]');if(!input.checked)input.click()})()`);
  const accuracyCount = await evaluate(`Number(document.querySelector('[title="Close accuracy table"]').closest('[data-journal-exclude]').innerText.match(/trade accuracy · (\\d+) setup/i)?.[1])`);
  await click('Open the saved trading journal and export Excel or Word reports');
  await pause(500);
  const journalCount = await evaluate(`Number(document.querySelector('[title="Close journal"]').closest('[data-journal-exclude]').innerText.match(/TOTAL TRADES\\s*(\\d+)/)?.[1])`);
  const counts = { accuracy: accuracyCount, journal: journalCount };
  assert.ok(Number.isFinite(counts.accuracy) && counts.accuracy > 0, JSON.stringify({counts,diagnostic}));
  assert.equal(counts.accuracy, counts.journal, 'accuracy and journal must count the same filtered setups');
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('reports/abhi-m15-fib-dashboard-2026-11-26.png', Buffer.from(shot.data, 'base64'));
  await click('Close journal');
  const liveWorker = await evaluate('window.__activeScalpWorker');
  await click('Choose a chart bar, then start candle-by-candle replay from that point');
  await pause(200);
  await click('START');
  for (let i = 0; i < 100; i++) { if (await evaluate('window.__activeScalpWorker') > liveWorker) break; await pause(100); }
  assert.ok(await evaluate('window.__activeScalpWorker') > liveWorker, 'Replay must run a fresh worker');
  await waitScan();
  const replay = await checkScan(false);
  assert.deepEqual(errors, []);
  const result = { counts, liveRecords: live.records.length, liveArrowFills: live.fills.length,
    replayRecords: replay.records.length, replayArrowFills: replay.fills.length,
    blockedSignalTimesExcluded: blockedTimes, browserErrors: errors };
  fs.writeFileSync('reports/abhi-m15-fib-dashboard-2026-11-26.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await call('Browser.close');
} finally { ws?.close(); browser.kill(); server.close(); }
