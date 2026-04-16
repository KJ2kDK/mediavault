import { useEffect, useRef, useCallback } from 'react';

/**
 * WebSocket hook for receiving remote commands (play, navigate, notify)
 * from the Telegram bot via the ws-hub.
 *
 * @param {object} opts
 * @param {function} opts.onPlay - called with { itemId, resumeAt, title, streamUrl }
 * @param {function} opts.onPlayChannel - called with { channelId, name, streamUrl }
 * @param {function} opts.onNavigate - called with (page, payload)
 * @param {function} opts.onNotify - called with text string
 * @param {function} opts.getPlayerStatus - returns { playing, title, progress } or null
 */
export default function useWebSocket({ onPlay, onPlayChannel, onNavigate, onNotify, getPlayerStatus }) {
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[ws] connected');
        // Clear any pending reconnect
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case 'play':
              if (onPlay) {
                onPlay(msg);
                // Confirm playback to server
                sendStatus({ type: 'player-status', playing: true, title: msg.title || '' });
              }
              break;
            case 'play-channel':
              if (onPlayChannel) {
                onPlayChannel(msg);
                sendStatus({ type: 'player-status', playing: true, title: msg.name || '' });
              }
              break;
            case 'navigate':
              if (onNavigate) onNavigate(msg.page, msg);
              break;
            case 'notify':
              if (onNotify) onNotify(msg.text);
              break;
            case 'ping':
              ws.send(JSON.stringify({ type: 'pong' }));
              break;
          }
        } catch (e) {
          console.warn('[ws] bad message:', e);
        }
      };

      ws.onclose = () => {
        console.log('[ws] disconnected, reconnecting in 5s...');
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch (e) {
      console.warn('[ws] connection failed:', e);
      reconnectTimer.current = setTimeout(connect, 5000);
    }
  }, [onPlay, onPlayChannel, onNavigate, onNotify]);

  const sendStatus = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Periodically send player status if available
  useEffect(() => {
    if (!getPlayerStatus) return;
    const interval = setInterval(() => {
      const status = getPlayerStatus();
      if (status) sendStatus({ type: 'player-status', ...status });
    }, 10000);
    return () => clearInterval(interval);
  }, [getPlayerStatus, sendStatus]);

  return { sendStatus };
}
