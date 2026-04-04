import { useCallback } from 'react';

// Post a log entry to the backend DB
async function postLog(level, source, message, err, context) {
  try {
    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        source,
        message: String(message),
        stack: err instanceof Error ? err.stack : undefined,
        context,
      }),
    });
  } catch {
    // fallback to console only — never throw from logger
    console.error('[useErrorLog] failed to post log', { level, source, message });
  }
}

export function useErrorLog(defaultSource) {
  const logError = useCallback((message, err, context) => {
    console.error(`[${defaultSource}]`, message, err ?? '');
    postLog('error', defaultSource, message, err, context);
  }, [defaultSource]);

  const logWarn = useCallback((message, context) => {
    console.warn(`[${defaultSource}]`, message);
    postLog('warn', defaultSource, message, undefined, context);
  }, [defaultSource]);

  const logInfo = useCallback((message, context) => {
    postLog('info', defaultSource, message, undefined, context);
  }, [defaultSource]);

  return { logError, logWarn, logInfo };
}

// Standalone helpers for use outside React components
export const errorLog = {
  error: (source, message, err, context) => postLog('error', source, message, err, context),
  warn:  (source, message, context)      => postLog('warn',  source, message, undefined, context),
  info:  (source, message, context)      => postLog('info',  source, message, undefined, context),
};

// Fetch logs from backend
export async function fetchLogs({ limit = 200, level, since } = {}) {
  const params = new URLSearchParams();
  if (limit !== 200) params.set('limit', limit);
  if (level)         params.set('level', level);
  if (since)         params.set('since', since);
  const qs = params.toString();
  const res = await fetch(`/api/logs${qs ? `?${qs}` : ''}`);
  return res.json(); // { logs: [...], total }
}

export async function fetchLogStats() {
  const res = await fetch('/api/logs/stats');
  return res.json(); // { error, warn, info }
}

export async function clearLogs(before) {
  const qs = before ? `?before=${before}` : '';
  const res = await fetch(`/api/logs${qs}`, { method: 'DELETE' });
  return res.json();
}
