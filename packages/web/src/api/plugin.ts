const FETCH_OPTS: RequestInit = { credentials: 'same-origin' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

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

export async function fetchPluginStatus(): Promise<PluginStatusResponse> {
  const res = await fetch('/api/plugin/status', FETCH_OPTS);
  if (!res.ok) throw new Error(`Plugin status failed: ${res.status}`);
  return res.json();
}

export async function installPlugin(key: string): Promise<void> {
  const res = await fetch('/api/plugin/install', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ plugin: key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Install failed: ${res.status}`);
  }
}

export async function uninstallPlugin(key: string): Promise<void> {
  const res = await fetch('/api/plugin/uninstall', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ plugin: key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Uninstall failed: ${res.status}`);
  }
}

export async function addMarketplace(source: string): Promise<void> {
  const res = await fetch('/api/plugin/marketplace/add', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ source }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Add marketplace failed: ${res.status}`);
  }
}

export async function removeMarketplace(name: string): Promise<void> {
  const res = await fetch('/api/plugin/marketplace/remove', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Remove marketplace failed: ${res.status}`);
  }
}

export async function updateMarketplace(name?: string): Promise<void> {
  const res = await fetch('/api/plugin/marketplace/update', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
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

export async function updatePlugin(key: string): Promise<UpdateResult> {
  const res = await fetch('/api/plugin/update', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ plugin: key }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Update plugin failed: ${res.status}`);
  }
  return res.json();
}
