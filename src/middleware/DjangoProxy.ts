// src/middleware/DjangoProxy.ts
//
// Express middleware that reverse-proxies Django-owned paths through the
// Node bot. Only the Node bot is exposed via ngrok, so any URL Django
// must answer (OAuth callback, health, chat, documents, etc.) is
// forwarded to localhost:8000.
//
// ★ FIX ★
// Teams SDK runs through Express with body-parser already mounted,
// which means `req` has been fully consumed by the time this middleware
// runs for POST requests. A naive `req.pipe(proxyReq)` sends an EMPTY
// body to Django → Django returns 400/403 → bot shows "not working".
//
// The fix: if `req.body` is already parsed (i.e. body-parser ran), we
// re-serialize it and write it directly to the upstream request. Only
// fall back to streaming `req` when the body was NOT consumed.

import type { Request, Response, NextFunction } from 'express';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

const DJANGO_HOST = process.env.EMPLOYEE_DJANGO_HOST || 'localhost';
const DJANGO_PORT = Number(process.env.EMPLOYEE_DJANGO_PORT || 8000);

// Paths we forward to Django. Everything else goes to the Teams SDK.
const PROXIED_PREFIXES = [
  '/manager/',
  '/admin/',
  '/static/',
  '/media/',
];

// Headers that MUST NOT be forwarded as-is (hop-by-hop, or that
// would break the upstream request).
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length', // recalculated
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
]);

function _hasParsedBody(req: Request): boolean {
  const b: any = (req as any).body;
  if (b === undefined || b === null) return false;
  if (typeof b === 'object' && Object.keys(b).length > 0) return true;
  if (typeof b === 'string' && b.length > 0) return true;
  return false;
}

function _serializeBody(req: Request): { data: Buffer; contentType?: string } | null {
  const b: any = (req as any).body;

  // Express body-parser with extended JSON
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) {
    const json = JSON.stringify(b);
    return {
      data: Buffer.from(json, 'utf8'),
      contentType: 'application/json',
    };
  }

  // Express body-parser with raw/urlencoded body
  if (typeof b === 'string') {
    return {
      data: Buffer.from(b, 'utf8'),
      contentType: req.headers['content-type'] as string | undefined,
    };
  }

  // Raw buffer (body-parser with type: 'application/octet-stream')
  if (Buffer.isBuffer(b)) {
    return {
      data: b,
      contentType: (req.headers['content-type'] as string) ?? 'application/octet-stream',
    };
  }

  return null;
}

export function djangoProxyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const pathname = req.path || '';
  const shouldProxy = PROXIED_PREFIXES.some((p) => pathname.startsWith(p));

  if (!shouldProxy) {
    return next();
  }

  console.log(`[DjangoProxy] → ${req.method} ${pathname}`);

  // Build clean headers
  const cleanHeaders: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
    cleanHeaders[k] = v;
  }
  cleanHeaders['host'] = `${DJANGO_HOST}:${DJANGO_PORT}`;
  cleanHeaders['x-forwarded-host'] = req.headers.host ?? '';
  cleanHeaders['x-forwarded-proto'] = 'https';
  cleanHeaders['ngrok-skip-browser-warning'] = 'true';

  const isBodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);

  const options = {
    hostname: DJANGO_HOST,
    port: DJANGO_PORT,
    path: req.originalUrl,
    method: req.method,
    headers: cleanHeaders,
  };

  const proxyReq = httpRequest(options, (proxyRes) => {
    // Force the correct charset so browsers don't mis-decode UTF-8
    const outgoing: Record<string, any> = { ...proxyRes.headers };
    res.writeHead(proxyRes.statusCode ?? 502, outgoing);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('[DjangoProxy] Error forwarding to Django:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end(
      `Proxy error: ${err.message}\n\n` +
      `Is Django running on http://${DJANGO_HOST}:${DJANGO_PORT}?\n`,
    );
  });

  // ★ The key fix ★ — if body-parser already consumed the body, we
  // re-emit it. Otherwise we stream the raw request.
  if (isBodyMethod) {
    const serialized = _hasParsedBody(req) ? _serializeBody(req) : null;

    if (serialized) {
      cleanHeaders['content-length'] = String(serialized.data.length);
      proxyReq.setHeader('content-length', String(serialized.data.length));
      if (serialized.contentType) {
        proxyReq.setHeader('content-type', serialized.contentType);
      }
      proxyReq.write(serialized.data);
      proxyReq.end();
      return;
    }

    // Body was not consumed by body-parser → stream it.
    req.pipe(proxyReq, { end: true });
    return;
  }

  // GET/HEAD etc. — no body.
  proxyReq.end();
}