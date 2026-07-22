/**
 * A rejected fetch (server restarted, machine asleep, connection dropped)
 * throws the browser's raw English "Failed to fetch", which would surface
 * verbatim in a Hebrew UI. Wrap it so every failure path reads the same.
 */
const OFFLINE_MESSAGE = "אין חיבור לשרת המקומי — ודא ש-npm run dashboard רץ"

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init)
  } catch {
    throw new Error(OFFLINE_MESSAGE)
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await request(path, {
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<T>
}

export async function postJson<T = { updated?: boolean; saved?: boolean }>(path: string, body: unknown): Promise<T> {
  const response = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<T>
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string }
    return payload.error || `שגיאת שרת (${response.status})`
  } catch {
    return `שגיאת שרת (${response.status})`
  }
}
