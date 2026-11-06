import https from 'node:https';
import { isIP } from 'node:net';

function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
}

function failedBeforeSending(error: unknown): boolean {
  const failure = error as { code?: string; syscall?: string; cause?: unknown; errors?: unknown[] };
  if (!failure || typeof failure !== 'object') return false;
  if (failure.cause) return failedBeforeSending(failure.cause);
  if (failure.errors?.length) return failure.errors.every(failedBeforeSending);
  return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH',
    'UND_ERR_CONNECT_TIMEOUT'].includes(failure.code ?? '')
    || (failure.code === 'ETIMEDOUT' && failure.syscall === 'connect');
}

// Re-resolve on every fallback so a network change never retains a stale route.
// Only retry failures known to precede sending the message to Telegram.
export async function telegramFetch(url: string, options: RequestInit): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== 'api.telegram.org') {
    throw new Error('Invalid Telegram API destination.');
  }
  try {
    return await fetch(url, options);
  } catch (error) {
    if (!failedBeforeSending(error)) throw error;
  }

  let resolved = false;
  const attempted = new Set<string>();
  for (const resolver of ['https://dns.google/resolve', 'https://cloudflare-dns.com/dns-query']) {
    let addresses: string[] = [];
    try {
      const response = await fetch(`${resolver}?name=api.telegram.org&type=A`, {
        headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const result = await response.json() as {
        Status?: number; Answer?: { name: string; type: number; data: string }[];
      };
      if (result.Status !== 0) continue;
      addresses = result.Answer?.filter(answer => answer.type === 1
        && answer.name.replace(/\.$/, '') === 'api.telegram.org'
        && publicIpv4(answer.data)).map(answer => answer.data) ?? [];
    } catch { /* Try the other encrypted DNS provider. */ }
    for (const address of addresses) {
      resolved = true;
      if (attempted.has(address)) continue;
      attempted.add(address);
      try { return await requestTelegram(target, options, address); }
      catch (error) {
        // A failed TLS connection cannot have delivered the HTTP message.
        // Once TLS is ready, an unknown delivery result must not be resent here.
        if (!(error instanceof TelegramConnectError)) throw error;
      }
    }
  }
  throw new Error(resolved
    ? 'Telegram is unreachable on this network after alternate DNS and connection attempts. Check your internet or VPN.'
    : 'Telegram DNS lookup failed, including both encrypted DNS providers. Check your internet or VPN.');
}

class TelegramConnectError extends Error {}

function requestTelegram(target: URL, options: RequestInit, address: string): Promise<Response> {
  // Keep the original hostname for TLS/SNI and certificate verification.
  // Never include the token-bearing URL in propagated transport errors.
  return new Promise<Response>((resolve, reject) => {
    let tlsReady = false;
    const request = https.request(target, {
      // A fresh socket makes the pre-TLS retry boundary unambiguous.
      agent: false,
      method: options.method,
      headers: Object.fromEntries(new Headers(options.headers).entries()),
      signal: AbortSignal.timeout(10_000),
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      },
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_000_000) request.destroy(new Error('Telegram response too large.'));
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new Error('Telegram response interrupted.')));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502 })));
    });
    request.on('socket', socket => {
      socket.once('secureConnect', () => { tlsReady = true; });
    });
    request.on('error', () => reject(tlsReady
      ? new Error('Telegram connection interrupted; delivery could not be confirmed.')
      : new TelegramConnectError('Telegram could not establish a secure connection.')));
    request.end(typeof options.body === 'string' ? options.body : undefined);
  });
}
