'use client';

import { useCallback, useEffect, useState } from 'react';
import { backendApi, emptySnapshot, type BackendSnapshot } from './backend-api';

const TOKEN_KEY = 'cutz-bangs-backend-token';

export function useBackendIntegration() {
  const [token, setToken] = useState('');
  const [data, setData] = useState<BackendSnapshot>(emptySnapshot);
  const [status, setStatus] = useState<'checking' | 'offline' | 'ready' | 'connected'>('checking');
  const [error, setError] = useState('');

  const refresh = useCallback(async (nextToken: string) => {
    setStatus('checking'); setError('');
    try {
      const snapshot = await backendApi.snapshot(nextToken);
      setData(snapshot); setToken(nextToken); setStatus('connected');
      sessionStorage.setItem(TOKEN_KEY, nextToken);
    } catch (cause) {
      sessionStorage.removeItem(TOKEN_KEY); setToken(''); setData(emptySnapshot);
      setError(cause instanceof Error ? cause.message : 'Backend connection failed.');
      try { await backendApi.health(); setStatus('ready'); } catch { setStatus('offline'); }
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    const timer = window.setTimeout(() => {
      if (saved) { void refresh(saved); return; }
      backendApi.health().then(() => setStatus('ready')).catch(() => setStatus('offline'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const login = async (email: string, password: string) => {
    setStatus('checking'); setError('');
    try {
      const session = await backendApi.login(email, password);
      await refresh(session.token);
      return true;
    } catch (cause) {
      setStatus('ready'); setError(cause instanceof Error ? cause.message : 'Login failed.');
      return false;
    }
  };

  const logout = () => { sessionStorage.removeItem(TOKEN_KEY); setToken(''); setData(emptySnapshot); setStatus('ready'); setError(''); };
  return { token, data, status, error, login, logout, refresh: () => token && refresh(token) };
}
