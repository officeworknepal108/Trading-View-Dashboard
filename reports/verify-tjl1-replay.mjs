// Isolated browser: real captured candles and sanitized trade facts, mocked APIs.
// No requests reach the user's running dashboard, broker, journal or Telegram.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
const mode = process.argv[2] ?? 'after';
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/tjl1-future-fib-2026-11-25.json'));
const root = path.resolve('dist');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] ?? 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tjl1-replay-'));
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(portFile) && i < 100; i++) await pause(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const fixture=${JSON.stringify(fixture)};
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,options)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(!url.pathname.startsWith('/api/'))return originalFetch(input,options);
      if(url.pathname==='/api/auth/me')return Response.json({user:{id:'tjl1-replay-test',username:'Replay test',role:'admin',status:'approved',verified:true,createdAt:1,canAccess:true}});
      if(url.pathname.includes('market-data')){
        const tf=url.searchParams.get('granularity')||'M15';
        if(tf!=='M15')return Response.json({ok:true,candles:[],symbol:'XAUUSD'});
        return Response.json({ok:true,symbol:'XAUUSD',candles:fixture.candles,source:'TradingView OANDA captured November 25'});
      }
      if(url.pathname.includes('/journal/trades'))return Response.json({ok:true,trades:fixture.records});
      if(url.pathname==='/api/mt5/status')return Response.json({ok:true,bridge:{connected:false},positions:[],recentSignals:[],config:{enabled:false,scalpingEnabled:false,intradayEnabled:true,scalpOneToOneEnabled:false,telegramMessagesEnabled:false}});
      return Response.json({ok:false,error:'Isolated replay test'});
    };
  ` });
  await call('Emulation.setDeviceMetricsOverride', { width: 1900, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  const click = async title => evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.title===${JSON.stringify(title)}||e.textContent.trim()===${JSON.stringify(title)});if(!e)throw Error('Missing button '+${JSON.stringify(title)});e.click();return true})()`);
  const rowExpression = `[...document.querySelectorAll('tr')].find(e=>e.textContent.includes('3,533.815')&&e.textContent.includes('3,540.137'))?.textContent`;
  for (let i = 0; i < 150; i++) { if (await evaluate(rowExpression)) break; await pause(100); }
  if (errors.length) throw new Error(errors.join('\n'));
  await click('Choose a chart bar, then start candle-by-candle replay from that point'); await pause(300);
  await click('START'); await pause(2000);
  const snapshots = [];
  for (let step = 0; step < 4; step++) {
    if (step) { await click('Next candle'); await pause(500); }
    snapshots.push(await evaluate(`(()=>{const row=${rowExpression};return {row,text:document.body.innerText,details:[...document.querySelectorAll('tr')].filter(e=>e.textContent.includes('3,542.500')&&e.textContent.includes('3,490.210')).map(e=>e.textContent)}})()`));
  }
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`reports/tjl1-replay-${mode}.png`, Buffer.from(shot.data, 'base64'));
  if (mode === 'after') for (const s of snapshots) {
    if (!s.row || !/NO TRADE/.test(s.row) || s.details.length) throw new Error('Invalid replay TJL1 entry remains: '+JSON.stringify({row:s.row,details:s.details}));
  }
  await click('Show indicator controls'); await pause(200);
  await click('Show or hide completed engulfing SL, RF, TP, total, and accuracy results'); await pause(500);
  const accuracyHasInvalidEntry = await evaluate(`/3,525\\.711|3,526\\.673/.test(document.body.innerText)`);
  await click('Open the saved trading journal and export Excel or Word reports'); await pause(500);
  const journalHasInvalidEntry = await evaluate(`/3,525\\.711|3,526\\.673/.test(document.body.innerText)`);
  if (mode === 'after' && (accuracyHasInvalidEntry || journalHasInvalidEntry)) throw Error('The invalid prices remain in accuracy or journal');
  const results = { mode, rows: snapshots.map(s => ({ row: s.row, invalidEntryDetails: s.details })), accuracyHasInvalidEntry, journalHasInvalidEntry, errors };
  fs.writeFileSync(`reports/tjl1-replay-${mode}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { ws?.close(); browser.kill(); server.close(); }
