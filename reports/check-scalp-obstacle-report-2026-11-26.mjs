// Isolated headless report check. No dashboard, account or trading endpoints.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scalp-research-report-'));
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(portFile) && i < 100; i++) await pause(100);
  assert.ok(fs.existsSync(portFile), 'Headless browser did not start');
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
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1200, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: pathToFileURL(path.resolve('reports/scalp-obstacle-research-2026-11-26.html')).href });
  for (let i = 0; i < 100; i++) {
    const result = await call('Runtime.evaluate', { expression: "document.readyState === 'complete' && document.querySelectorAll('.chart canvas').length >= 8", returnByValue: true });
    if (result.result.value) break;
    await pause(100);
  }
  const state = await call('Runtime.evaluate', { expression: "({title:document.title,charts:document.querySelectorAll('.chart').length,canvases:document.querySelectorAll('.chart canvas').length,tables:document.querySelectorAll('table').length,hasResult:document.body.innerText.includes('+38.10R')})", returnByValue: true });
  assert.equal(state.result.value.charts, 4);
  assert.ok(state.result.value.canvases >= 8);
  assert.ok(state.result.value.hasResult);
  assert.deepEqual(errors, []);
  const top = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('reports/scalp-obstacle-research-2026-11-26-preview.png', Buffer.from(top.data, 'base64'));
  await call('Runtime.evaluate', { expression: "document.querySelector('.chart').scrollIntoView({block:'center'})" });
  await pause(300);
  const chart = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('reports/scalp-obstacle-research-2026-11-26-chart-preview.png', Buffer.from(chart.data, 'base64'));
  console.log(JSON.stringify({ ...state.result.value, browserErrors: errors }));
  await call('Browser.close');
} finally {
  ws?.close();
  browser.kill();
}
