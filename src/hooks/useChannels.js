import { useState, useEffect } from 'react';

// Module-level cache — shared across the entire app lifetime
let _channels = [];
const _listeners = new Set();

function notify() {
  _listeners.forEach((fn) => fn());
}

export function setChannelCache(channels) {
  _channels = channels;
  notify();
}

export function getChannelCache() {
  return _channels;
}

// React hook — re-renders subscribers when cache updates
export function useChannels() {
  const [, tick] = useState(0);

  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  }, []);

  return _channels;
}
