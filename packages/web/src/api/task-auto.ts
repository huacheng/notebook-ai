function authHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function stopAutoMode(
  sessionId: string,
  token: string | null,
): Promise<{ status: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/task-auto`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  return res.json();
}

export async function getAutoStatus(
  sessionId: string,
  token: string | null,
): Promise<{ daemon_active: boolean; status: string } | null> {
  const res = await fetch(`/api/sessions/${sessionId}/task-auto`, {
    headers: authHeaders(token),
  });
  if (res.status === 404) return null;
  return res.json();
}

export async function startAutoMode(
  sessionId: string,
  token: string | null,
  opts: { taskDir: string; maxIterations?: number; timeoutMinutes?: number },
): Promise<{ status: string; sessionId: string; taskDir: string; maxIterations: number; timeoutMinutes: number }> {
  const res = await fetch(`/api/sessions/${sessionId}/task-auto`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      taskDir: opts.taskDir,
      maxIterations: opts.maxIterations ?? 20,
      timeoutMinutes: opts.timeoutMinutes ?? 30,
    }),
  });
  return res.json();
}
