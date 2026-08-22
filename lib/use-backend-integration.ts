'use client';

import { useCallback, useEffect, useState } from 'react';
import { backendApi, emptySnapshot, type BackendSnapshot } from './backend-api';

export const SESSION_MARKER = 'cookie-session';
const LEGACY_TOKEN_KEY = 'cutz-bangs-backend-token';

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
    } catch (cause) {
      setToken(''); setData(emptySnapshot);
      setError(cause instanceof Error ? cause.message : 'Backend connection failed.');
      try { await backendApi.health(); setStatus('ready'); } catch { setStatus('offline'); }
    }
  }, []);

  useEffect(() => {
    // Remove bearer tokens saved by older builds; sessions now live only in an
    // HttpOnly cookie managed by the same-origin backend proxy.
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    const timer = window.setTimeout(() => {
      void refresh(SESSION_MARKER);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const login = async (email: string, password: string, secondFactor?: { code?: string; recoveryCode?: string }) => {
    setStatus('checking'); setError('');
    try {
      const session = await backendApi.login(email, password, secondFactor);
      if ('twoFactorRequired' in session && session.twoFactorRequired) {
        setStatus('ready');
        return 'two_factor_required' as const;
      }
      await refresh(session.token);
      return 'connected' as const;
    } catch (cause) {
      setStatus('ready'); setError(cause instanceof Error ? cause.message : 'Login failed.');
      return 'failed' as const;
    }
  };

  const logout = () => {
    if (token) void backendApi.logout(token).catch(() => undefined);
    setToken(''); setData(emptySnapshot); setStatus('ready'); setError('');
  };
  return { token, data, status, error, login, logout, refresh: () => token && refresh(token) };
}
