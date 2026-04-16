import { WebSocketServer } from 'ws';

let wss = null;

const PING_INTERVAL = 30_000;
const ACTION_TIMEOUT = 5_000;

function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[ws-hub] client connected (${ip}) — total: ${getConnectedCount()}`);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        ws.emit('json', msg);
      } catch {
        console.warn('[ws-hub] received non-JSON message, ignoring');
      }
    });

    ws.on('close', () => {
      console.log(`[ws-hub] client disconnected — total: ${getConnectedCount()}`);
    });

    ws.on('error', (err) => {
      console.error('[ws-hub] client error:', err.message);
    });
  });

  const pingTimer = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        console.log('[ws-hub] terminating dead connection');
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_INTERVAL);

  wss.on('close', () => clearInterval(pingTimer));

  console.log('[ws-hub] WebSocket server attached on /ws');
  return wss;
}

function broadcast(msg) {
  if (!wss) return;
  const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

function sendAction(action) {
  return new Promise((resolve) => {
    if (!wss || getConnectedCount() === 0) {
      resolve({ confirmed: false });
      return;
    }

    broadcast(action);

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ confirmed: false });
    }, ACTION_TIMEOUT);

    function onStatus(msg) {
      if (msg.type === 'player-status' && msg.playing) {
        cleanup();
        resolve({ confirmed: true, ...msg });
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      if (!wss) return;
      for (const ws of wss.clients) {
        ws.removeListener('json', onStatus);
      }
    }

    for (const ws of wss.clients) {
      ws.on('json', onStatus);
    }
  });
}

function getConnectedCount() {
  return wss ? wss.clients.size : 0;
}

export { initWebSocket, broadcast, sendAction, getConnectedCount };
