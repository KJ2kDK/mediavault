// Resilient fetch for external APIs.
//
// In the production container, libc getaddrinfo (the default lookup undici's
// global fetch uses) intermittently returns ENOTFOUND under sustained load —
// the server does thousands of IPTV DNS lookups per minute, which starves the
// libuv threadpool that getaddrinfo runs on. A fresh process resolves the same
// host fine, so the failure is process/load-specific, not a real DNS outage.
//
// This wraps undici with an Agent whose lookup tries libc first, then falls
// back to dns.resolve4 (c-ares, off the threadpool). undici sets the Host
// header from the URL, so handing it an IP for the original hostname keeps the
// correct Host/SNI automatically. routes/iptv.js uses the same approach for the
// streaming proxy; this is the shared, reusable version.

import dnsModule, { promises as dns } from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';

const dnsCache = new Map(); // hostname → { ip, expires }
const DNS_TTL = 60_000;

// undici v6 calls lookup with { all: true }, expecting cb(err, [{address, family}, ...])
function resolveLookup(hostname, _opts, cb) {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) {
    return cb(null, [{ address: cached.ip, family: 4 }]);
  }

  dnsModule.lookup(hostname, { family: 4, all: true }, (err, addresses) => {
    if (!err && addresses?.length) {
      dnsCache.set(hostname, { ip: addresses[0].address, expires: Date.now() + DNS_TTL });
      return cb(null, addresses);
    }
    // Fallback to c-ares resolve4 (works when libc getaddrinfo is starved)
    dns.resolve4(hostname).then((addrs) => {
      if (!addrs.length) return cb(new Error(`No A record for ${hostname}`));
      dnsCache.set(hostname, { ip: addrs[0], expires: Date.now() + DNS_TTL });
      cb(null, addrs.map((a) => ({ address: a, family: 4 })));
    }).catch(cb);
  });
}

const resilientAgent = new Agent({
  connect: { lookup: resolveLookup },
  headersTimeout: 15_000,
  bodyTimeout: 30_000,
});

// Drop-in fetch that routes through the resilient DNS agent.
export function resilientFetch(url, opts = {}) {
  return undiciFetch(url, { ...opts, dispatcher: resilientAgent });
}
