// Everything the website asks the server goes through here, with the sign-in token attached.
export const API: string = ((import.meta.env.VITE_API_BASE as string | undefined) || 'https://api.161-97-98-107.sslip.io').replace(/\/+$/, '');

const TOKEN_KEY = 'shule_token';
let token: string | null = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();

export const getToken = () => token;
export function setToken(value: string | null) {
  token = value;
  try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface Options { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean; signal?: AbortSignal }

export async function api<T = Record<string, unknown>>(path: string, { method, body, auth = true, signal }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(API + path, { method: method || (body !== undefined ? 'POST' : 'GET'), headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || (data && data.status === 'error')) {
    if (res.status === 401 && auth && token) window.dispatchEvent(new Event('shule:expired'));
    throw new ApiError(res.status, (data && data.message) || 'Something went wrong. Please try again.');
  }
  return data as T;
}

// A file (a PDF or a photo) fetched with the sign-in token, as bytes.
export async function fetchBytes(path: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(API + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'No connection. Check your internet and try again.');
  }
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event('shule:expired'));
    throw new ApiError(res.status, res.status === 404 ? 'This document is not available.' : res.status === 402 ? 'payment_required' : 'Could not load this document.');
  }
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !onProgress || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out.buffer;
}
