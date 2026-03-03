import type { StateCreator } from 'zustand';
import type { NotebookStore } from './types';

export const createAuthSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'authToken' | 'authRequired' | 'authError' | 'authRetryAfter' | 'authLoading' | 'authVerifying'
  | 'checkAuthStatus' | 'login' | 'logout' | 'register' | 'clearAuthError'
>> = (set, get) => ({
  authToken: sessionStorage.getItem('nb-auth-token'),
  authRequired: null,
  authError: null,
  authRetryAfter: 0,
  authLoading: false,
  authVerifying: true, // True until token validation completes

  async checkAuthStatus() {
    set({ authVerifying: true });
    try {
      const res = await fetch('/api/auth/status');
      const data = (await res.json()) as { authEnabled: boolean };
      set({ authRequired: data.authEnabled });

      if (data.authEnabled) {
        const token = get().authToken;
        if (token) {
          // Validate stored token via /verify (not /login)
          // to avoid triggering brute-force rate limiting.
          const check = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (!check.ok) {
            sessionStorage.removeItem('nb-auth-token');
            set({ authToken: null });
          }
        }
      }
    } catch {
      set({ authRequired: false });
    } finally {
      // Token validation complete — safe to render authenticated components
      set({ authVerifying: false });
    }
  },

  async login(email: string, password: string) {
    set({ authLoading: true, authError: null });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string; retryAfter?: number };
        set({ authError: data.error, authRetryAfter: data.retryAfter ?? 0, authLoading: false });
        return;
      }
      const data = (await res.json()) as { token: string };
      sessionStorage.setItem('nb-auth-token', data.token);
      // Login success — token is validated, no need to verify again
      set({ authToken: data.token, authError: null, authRetryAfter: 0, authLoading: false, authVerifying: false });
    } catch {
      set({ authError: 'Failed to connect to server.', authLoading: false });
    }
  },

  logout() {
    sessionStorage.removeItem('nb-auth-token');
    set({ authToken: null });
    get().disconnectWebSocket();
  },

  async register(username: string, password: string, inviteCode: string): Promise<boolean> {
    set({ authLoading: true, authError: null });
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, inviteCode }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string; retryAfter?: number };
        set({ authError: data.error, authRetryAfter: data.retryAfter ?? 0, authLoading: false });
        return false;
      }
      set({ authError: null, authRetryAfter: 0, authLoading: false });
      return true;
    } catch {
      set({ authError: 'Failed to connect to server.', authLoading: false });
      return false;
    }
  },

  clearAuthError() {
    set({ authError: null, authRetryAfter: 0 });
  },
});
