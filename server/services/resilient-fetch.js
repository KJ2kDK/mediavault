// Resilient fetch for external APIs, built on Node's native https/http.
//
// Why not global fetch (undici)? In the long-running server process, undici's
// connector intermittently fails external lookups with `getaddrinfo ENOTFOUND _`
// (hostname mangled to "_") even though dns.resolve4 / dns.lookup resolve the
// same host fine in that very process. Node's core https module uses a separate
// DNS path and isn't affected. We also pin a dedicated c-ares resolver to public
// DNS (1.1.1.1 / 8.8.8.8) to dodge the Docker embedded resolver (127.0.0.11),
// which buckles under the server's heavy IPTV DNS load.

import https from 'node:https';
import http from 'node:http';
import dnsModule from 'node:dns';

const resolver = new dnsModule.promises.Resolver({ timeout: 5000, tries: 2 });
resolver.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8']);

const dnsCache = new Map(); // hostname → { ip, expires }
const DNS_TTL = 5 * 60_000;

async function resolveHost(hostname) {
  console.error('[resilient-fetch] resolveHost hostname=', JSON.stringify(hostname));
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname; // already an IP
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.ip;
  let addrs;
  try {
    addrs = await resolver.resolve4(hostname);            // public DNS
    console.error('[resilient-fetch] resolve4 ok', hostname, addrs);
  } catch (e1) {
    console.error('[resilient-fetch] resolve4 FAIL', hostname, e1.code, '-> libc fallback');
    addrs = (await dnsModule.promises.lookup(hostname, { all: true, family: 4 })).map((a) => a.address); // libc fallback
  }
  if (!addrs?.length) throw Object.assign(new Error(`No A record for ${hostname}`), { code: 'ENOTFOUND' });
  const ip = addrs[0];
  dnsCache.set(hostname, { ip, expires: Date.now() + DNS_TTL });
  return ip;
}

// Minimal fetch-like response wrapping a Buffer body.
function makeResponse(status, headers, bodyBuf, finalUrl) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: finalUrl,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    async text() { return bodyBuf.toString('utf8'); },
    async json() { return JSON.parse(bodyBuf.toString('utf8')); },
    async arrayBuffer() { return bodyBuf.buffer.slice(bodyBuf.byteOffset, bodyBuf.byteOffset + bodyBuf.byteLength); },
  };
}

function doRequest(urlStr, opts, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(e); }
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    resolveHost(parsed.hostname).then((ip) => {
      const reqOpts = {
        host: ip,                                  // connect by resolved IP
        servername: parsed.hostname,               // correct TLS SNI
        port: parsed.port || (isHttps ? 443 : 80),
        method: opts.method || 'GET',
        path: parsed.pathname + parsed.search,
        headers: { Host: parsed.host, ...(opts.headers || {}) },
        timeout: opts.timeout || 20_000,
      };

      const req = mod.request(reqOpts, (res) => {
        // Follow redirects (OpenSubtitles download links use them).
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          console.error('[resilient-fetch] REDIRECT', res.statusCode, 'from', urlStr, '-> location=', JSON.stringify(res.headers.location));
          res.resume();
          const next = new URL(res.headers.location, parsed).toString();
          return resolve(doRequest(next, opts, redirectsLeft - 1));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(makeResponse(res.statusCode, res.headers, Buffer.concat(chunks), urlStr)));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(Object.assign(new Error('Request timeout'), { code: 'ETIMEDOUT' })));
      if (opts.body) req.write(opts.body);
      req.end();
    }).catch(reject);
  });
}

// Drop-in fetch (subset) that resolves via public DNS and retries transient
// DNS/network failures.
export async function resilientFetch(url, opts = {}, retries = 4, delay = 250) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await doRequest(url, opts, 5);
    } catch (err) {
      lastErr = err;
      const code = err.code || err.cause?.code;
      const transient = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(code);
      if (transient && attempt < retries) {
        await new Promise((r) => setTimeout(r, delay * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
