const FETCH_OPTS: RequestInit = { credentials: 'same-origin' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function stopAutoMode(
  sessionId: string,
): Promise<{ status: string }> {
  const res = await fetch(`/api/sessions/${sessionId}/task-auto`, {
    method: 'DELETE',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
  });
  return res.json();
}

export async function getAutoStatus(
  sessionId: string,
): Promise<{ daemon_active: boolean; status: string } | null> {
  const res = await fetch(`/api/sessions/${sessionId}/task-auto`, FETCH_OPTS);
  if (res.status === 404) return null;
  return res.json();
}

export async function startAutoMode(
  sessionId: string,
  opts: { taskDir: string; maxIterations?: number; timeoutMinutes?: number },
): Promise<{ status: string; sessionId: string; taskDir: string; maxIterations: number; timeoutMinutes: number }> {
  const res = await fetch(`/api/sessions/${sessionId}/task-auto`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({
      taskDir: opts.taskDir,
      maxIterations: opts.maxIterations ?? 20,
      timeoutMinutes: opts.timeoutMinutes ?? 30,
    }),
  });
  return res.json();
}
