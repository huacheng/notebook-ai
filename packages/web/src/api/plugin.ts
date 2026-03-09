function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export interface MarketplaceInfo {
  name: string;
  source: { source: string; repo?: string; url?: string };
  lastUpdated?: string;
}

export interface PluginInfo {
  name: string;
  marketplace: string;
  key: string;
  description?: string;
  version?: string;
  category?: string;
}

export interface InstalledEntry {
  version?: string;
  installedAt?: string;
}

export interface PluginStatusResponse {
  marketplaces: MarketplaceInfo[];
  plugins: PluginInfo[];
  installed: Record<string, InstalledEntry>;
}

export async function fetchPluginStatus(token: string | null): Promise<PluginStatusResponse> {
  const res = await fetch('/api/plugin/status', { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Plugin status failed: ${res.status}`);
  return res.json();
}

export async function installPlugin(token: string | null, key: string): Promise<void> {
  const res = await fetch('/api/plugin/install', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugin: key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Install failed: ${res.status}`);
  }
}

export async function uninstallPlugin(token: string | null, key: string): Promise<void> {
  const res = await fetch('/api/plugin/uninstall', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugin: key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Uninstall failed: ${res.status}`);
  }
}

export async function addMarketplace(token: string | null, source: string): Promise<void> {
  const res = await fetch('/api/plugin/marketplace/add', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Add marketplace failed: ${res.status}`);
  }
}

export async function removeMarketplace(token: string | null, name: string): Promise<void> {
  const res = await fetch('/api/plugin/marketplace/remove', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Remove marketplace failed: ${res.status}`);
  }
}

export async function updateMarketplace(token: string | null, name?: string): Promise<void> {
  const res = await fetch('/api/plugin/marketplace/update', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Update marketplace failed: ${res.status}`);
  }
}

export interface UpdateResult {
  ok: boolean;
  steps: string[];
}

export async function updatePlugin(token: string | null, key: string): Promise<UpdateResult> {
  const res = await fetch('/api/plugin/update', {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugin: key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Update plugin failed: ${res.status}`);
  }
  return res.json();
}
