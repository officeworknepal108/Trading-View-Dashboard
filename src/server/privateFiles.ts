import type { RequestHandler } from 'express';

export const privateFilePatterns = [
  '**/.dashboard-auth/**', '**/.code-lock/**', '**/.git/**', '**/data/**',
  '**/backups/**', '**/.env', '**/.env.*', '**/.mt5*', '**/*.log', '**/*.{crt,pem}',
];

// Vite serves workspace files in development. Keep runtime data private there too.
export const denyPrivateFiles: RequestHandler = (req, res, next) => {
  let pathname = req.path;
  try {
    for (let pass = 0; pass < 3; pass++) pathname = decodeURIComponent(pathname);
  } catch { res.sendStatus(400); return; }
  pathname = pathname.replace(/\\/g, '/');
  if (/(?:^|\/)(?:\.dashboard-auth|\.code-lock|\.git|data|backups)(?:\/|$)/i.test(pathname)
    || /(?:^|\/)(?:\.env[^/]*|\.mt5[^/]*|[^/]*\.log)(?:\/|$)/i.test(pathname)) {
    res.sendStatus(404); return;
  }
  next();
};
