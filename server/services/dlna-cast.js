/**
 * DLNA/UPnP casting service for MediaVault.
 *
 * Discovers DLNA renderers (Shield, smart TVs, etc.) on the local network
 * via SSDP and controls playback via UPnP AV Transport.
 *
 * The renderer (Shield) pulls the raw file from MediaVault's stream endpoint,
 * giving full codec support — Atmos, DTS-HD, TrueHD passthrough to receiver.
 */

import { Client as SsdpClient } from 'node-ssdp';

const RENDERER_URN = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const TRANSPORT_URN = 'urn:schemas-upnp-org:service:AVTransport:1';

// Cached discovered renderers: { friendlyName, location, controlUrl, host }
let renderers = new Map();
let lastScan = 0;
const SCAN_CACHE_MS = 30_000;

// ── SSDP Discovery ──────────────────────────────────────────────────────────

export async function discoverRenderers(timeoutMs = 5000) {
  // Return cached if recent
  if (Date.now() - lastScan < SCAN_CACHE_MS && renderers.size > 0) {
    return [...renderers.values()];
  }

  return new Promise((resolve) => {
    const found = new Map();
    const client = new SsdpClient();

    client.on('response', async (headers) => {
      const location = headers.LOCATION;
      if (!location || found.has(location)) return;

      try {
        const info = await fetchDeviceInfo(location);
        if (info) {
          found.set(location, info);
        }
      } catch {}
    });

    client.search(RENDERER_URN);

    setTimeout(() => {
      try { client.stop(); } catch {}
      renderers = found;
      lastScan = Date.now();
      console.log(`[dlna] Found ${found.size} renderer(s): ${[...found.values()].map(r => r.friendlyName).join(', ') || 'none'}`);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

async function fetchDeviceInfo(location) {
  const r = await fetch(location, { signal: AbortSignal.timeout(3000) });
  const xml = await r.text();

  const name = xml.match(/<friendlyName>([^<]+)/)?.[1];
  if (!name) return null;

  // Find AVTransport control URL
  const serviceBlock = xml.match(/<service>[\s\S]*?AVTransport[\s\S]*?<\/service>/i);
  if (!serviceBlock) return null;

  const controlPath = serviceBlock[0].match(/<controlURL>([^<]+)/)?.[1];
  if (!controlPath) return null;

  const base = new URL(location);
  const controlUrl = new URL(controlPath, base.origin).href;

  return {
    friendlyName: name,
    location,
    controlUrl,
    host: base.host,
  };
}

// ── UPnP AV Transport Control ───────────────────────────────────────────────

function soapRequest(controlUrl, action, body) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${TRANSPORT_URN}">
      <InstanceID>0</InstanceID>
      ${body}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  return fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${TRANSPORT_URN}#${action}"`,
    },
    body: xml,
    signal: AbortSignal.timeout(5000),
  });
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function castToRenderer(renderer, mediaUrl, title = 'MediaVault') {
  const mime = mediaUrl.includes('.mkv') || mediaUrl.includes('mode=remux')
    ? 'video/x-matroska'
    : 'video/mp4';

  const metadata = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
    <item id="0" parentID="-1" restricted="1">
      <dc:title>${escapeXml(title)}</dc:title>
      <upnp:class>object.item.videoItem.movie</upnp:class>
      <res protocolInfo="http-get:*:${mime}:*">${escapeXml(mediaUrl)}</res>
    </item>
  </DIDL-Lite>`;

  // Stop any current playback
  try { await soapRequest(renderer.controlUrl, 'Stop', ''); } catch {}

  // Set the media URI
  await soapRequest(renderer.controlUrl, 'SetAVTransportURI', `
    <CurrentURI>${escapeXml(mediaUrl)}</CurrentURI>
    <CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>
  `);

  // Play
  await soapRequest(renderer.controlUrl, 'Play', '<Speed>1</Speed>');

  return { success: true, renderer: renderer.friendlyName, mediaUrl };
}

export async function stopRenderer(renderer) {
  await soapRequest(renderer.controlUrl, 'Stop', '');
}

export async function pauseRenderer(renderer) {
  await soapRequest(renderer.controlUrl, 'Pause', '');
}

// ── Convenience: find renderer by name ──────────────────────────────────────

export async function findRenderer(nameHint) {
  const list = await discoverRenderers();
  if (!list.length) return null;
  if (!nameHint) return list[0]; // default to first found

  const lower = nameHint.toLowerCase();
  return list.find(r => r.friendlyName.toLowerCase().includes(lower)) || list[0];
}

export async function getRendererNames() {
  const list = await discoverRenderers();
  return list.map(r => r.friendlyName);
}
