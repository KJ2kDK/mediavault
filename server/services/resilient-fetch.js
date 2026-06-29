// Resilient fetch for external APIs.
//
// Root problem: the container's resolv.conf points at Docker's embedded
// resolver (127.0.0.11), which buckles under the server's IPTV DNS load
// (thousands of lookups/min against ephemeral CDN hosts). Once it's saturated,
// unrelated lookups like rest.opensubtitles.org fail with ENOTFOUND — even
// though a fresh, idle process resolves them fine. libc getaddrinfo AND the
// default dns.resolve4 both funnel through 127.0.0.11, so both fail under load.
//
// Fix: resolve through a dedicated c-ares resolver pinned to public DNS
// (1.1.1.1 / 8.8.8.8), bypassing 127.0.0.11 entirely, with a short cache and
// retries. We hand undici the resolved IP via a custom Agent lookup; undici
// still derives Host/SNI from the URL, so TLS stays correct.

import dnsModule from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';

// Dedicated resolver that talks straight to public DNS, NOT the Docker
// embedded resolver that melts under IPTV load.
const resolver = new dnsModule.promises.Resolver({ timeout: 5000, tries: 2 });
resolver.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8']);

const dnsCache = new Map(); // hostname → { ip, expires }
const DNS_TTL = 5 * 60_000;

async function resolveHost(hostname) {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.ip;
  const addrs = await resolver.resolve4(hostname);
  if (!addrs.length) throw Object.assign(new Error(`No A record for ${hostname}`), { code: 'ENOTFOUND' });
  const ip = addrs[0];
  dnsCache.set(hostname, { ip, expires: Date.now() + DNS_TTL });
  return ip;
}

// undici v6 calls lookup with { all: true }, expecting cb(err, [{address, family}, ...])
function resolveLookup(hostname, _opts, cb) {
  resolveHost(hostname)
    .then((ip) => cb(null, [{ address: ip, family: 4 }]))
    // Last-ditch: fall back to libc (works when public DNS is the thing failing)
    .catch(() => dnsModule.lookup(hostname, { family: 4, all: true }, cb));
}

const resilientAgent = new Agent({
  connect: { lookup: resolveLookup },
  headersTimeout: 15_000,
  bodyTimeout: 30_000,
});

function isDnsError(err) {
  const code = err.cause?.code || err.code;
  return code === 'ENOTFOUND' || code === 'EAI_AGAIN';
}

// Drop-in fetch that resolves via public DNS and retries transient DNS/network
// failures (the embedded-resolver flakiness is intermittent).
export async function resilientFetch(url, opts = {}, retries = 4, delay = 250) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await undiciFetch(url, { ...opts, dispatcher: resilientAgent });
    } catch (err) {
      lastErr = err;
      const code = err.cause?.code || err.code;
      const transient = isDnsError(err) || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT';
      if (transient && attempt < retries) {
        await new Promise((r) => setTimeout(r, delay * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
