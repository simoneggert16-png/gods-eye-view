import zlib from 'node:zlib';
import crypto from 'node:crypto';

/**
 * High-performance backend accelerator for God's Eye View:
 * 1. Disables Nagle's algorithm (TCP NoDelay) for instant socket packet sends.
 * 2. Gzip compression on all large /api/ JSON/text responses (>1KB).
 * 3. ETag generation + 304 Not Modified support so clients don't re-download unchanged data.
 * 4. Keep-Alive connection persistence for frequent polling cycles.
 * 5. Transparent bypass for binary media streams (CCTV video feeds, MJPEG, camera frames, WebSockets).
 */
export function backendSpeedAccelerator() {
  return {
    name: 'backend-speed-accelerator',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // 1. Instant socket transmission
        if (req.socket && typeof req.socket.setNoDelay === 'function') {
          req.socket.setNoDelay(true);
        }

        const url = req.url || '';
        // Skip non-API routes and streaming / binary media endpoints
        if (
          !url.startsWith('/api/') ||
          url.startsWith('/api/cctv/media') ||
          url.startsWith('/api/cctv/frame') ||
          url.startsWith('/api/cctv/stream') ||
          url.startsWith('/api/openai-realtime') ||
          url.startsWith('/api/ais-stream') ||
          req.headers?.upgrade === 'websocket'
        ) {
          return next();
        }

        // Set Keep-Alive headers
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Keep-Alive', 'timeout=30, max=1000');

        const origWrite = res.write;
        const origEnd = res.end;
        const origWriteHead = res.writeHead;

        let chunks = [];
        let explicitStatusCode = null;
        let explicitStatusMessage = null;

        res.writeHead = function (status, reason, headers) {
          let hdrs = headers;
          let msg = undefined;
          if (typeof reason === 'string') {
            msg = reason;
          } else if (typeof reason === 'object' && reason !== null) {
            hdrs = reason;
          }
          explicitStatusCode = status;
          explicitStatusMessage = msg;
          if (hdrs) {
            for (const [k, v] of Object.entries(hdrs)) {
              res.setHeader(k, v);
            }
          }
          return res;
        };

        res.write = function (chunk, ...args) {
          if (res.headersSent) {
            return origWrite.call(res, chunk, ...args);
          }
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return true;
        };

        res.end = function (chunk, ...args) {
          if (res.headersSent) {
            return origEnd.call(res, chunk, ...args);
          }
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }

          res.write = origWrite;
          res.end = origEnd;
          res.writeHead = origWriteHead;

          const statusCode = explicitStatusCode || res.statusCode || 200;
          res.statusCode = statusCode;
          if (explicitStatusMessage) res.statusMessage = explicitStatusMessage;

          if (chunks.length === 0) {
            if (explicitStatusCode) origWriteHead.call(res, explicitStatusCode);
            return origEnd.call(res);
          }

          const body = Buffer.concat(chunks);
          const contentType = String(res.getHeader('content-type') || '');
          const isCompressible =
            contentType.includes('json') ||
            contentType.includes('text') ||
            contentType.includes('javascript') ||
            contentType.includes('xml');

          // ETag handling for GET/HEAD
          if ((req.method === 'GET' || req.method === 'HEAD') && statusCode === 200) {
            const hash = crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16);
            const etag = `W/"${body.length.toString(16)}-${hash}"`;
            res.setHeader('ETag', etag);

            // Revalidate via ETag if Cache-Control was no-store or absent
            const currentCc = String(res.getHeader('cache-control') || '');
            if (!currentCc || currentCc === 'no-store') {
              res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            }

            const clientEtag = req.headers?.['if-none-match'];
            if (clientEtag && clientEtag === etag) {
              res.removeHeader('content-length');
              res.removeHeader('content-type');
              res.statusCode = 304;
              origWriteHead.call(res, 304);
              return origEnd.call(res);
            }
          }

          // Gzip compression for bodies > 1KB
          const acceptEncoding = String(req.headers?.['accept-encoding'] || '');
          const canGzip = acceptEncoding.includes('gzip');

          if (canGzip && isCompressible && body.length > 1024 && !res.getHeader('content-encoding')) {
            try {
              const compressed = zlib.gzipSync(body, { level: 6 });
              res.setHeader('Content-Encoding', 'gzip');
              res.setHeader('Content-Length', String(compressed.length));
              res.setHeader('Vary', 'Accept-Encoding');
              if (explicitStatusCode) origWriteHead.call(res, statusCode);
              return origEnd.call(res, req.method === 'HEAD' ? undefined : compressed);
            } catch {
              // fallback on compression error
            }
          }

          res.setHeader('Content-Length', String(body.length));
          if (explicitStatusCode) origWriteHead.call(res, statusCode);
          return origEnd.call(res, req.method === 'HEAD' ? undefined : body);
        };

        next();
      });
    },
  };
}
