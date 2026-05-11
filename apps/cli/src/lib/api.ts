// Typed fetch wrapper for the envstore API.
// Adds Authorization: Bearer <token> from local creds. Surfaces server errors
// as ApiError so commands can pretty-print them.

import { ApiError, AuthRequiredError } from './errors';
import { loadToken } from './creds';
import { CLI_VERSION } from './paths';

export type ApiClient = {
  apiUrl: string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  // Unauthenticated variants for bootstrap (device-code endpoints)
  postPublic<T>(path: string, body?: unknown): Promise<T>;
};

type ErrorPayload = { error?: string; message?: string; hint?: string };

async function parseError(res: Response): Promise<ApiError> {
  let body: ErrorPayload | undefined;
  try {
    body = (await res.json()) as ErrorPayload;
  } catch {
    // not JSON
  }
  const message = body?.error ?? body?.message ?? `HTTP ${res.status} ${res.statusText}`;
  return new ApiError(message, res.status, body?.hint);
}

async function authHeader(apiUrl: string, required: boolean): Promise<Record<string, string>> {
  if (!required) return {};
  const token = await loadToken(apiUrl);
  if (!token) throw new AuthRequiredError();
  return { authorization: `Bearer ${token}` };
}

const baseHeaders = {
  'user-agent': `envstore-cli/${CLI_VERSION}`,
  accept: 'application/json',
};

async function request<T>(
  apiUrl: string,
  method: string,
  path: string,
  body: unknown,
  auth: boolean,
): Promise<T> {
  const headers: Record<string, string> = {
    ...baseHeaders,
    ...(await authHeader(apiUrl, auth)),
  };
  // We only POST JSON, so a plain string body is enough — avoids dragging in
  // DOM lib for the BodyInit type.
  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, { method, headers, body: payload });
  } catch (err) {
    throw new ApiError(
      `Could not reach ${apiUrl}: ${(err as Error).message}`,
      0,
      'Check your network or set ENVSTORE_API_URL.',
    );
  }
  if (res.status === 401 && auth) {
    throw new AuthRequiredError();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function makeClient(apiUrl: string): ApiClient {
  return {
    apiUrl,
    get: <T>(p: string) => request<T>(apiUrl, 'GET', p, undefined, true),
    post: <T>(p: string, b?: unknown) => request<T>(apiUrl, 'POST', p, b, true),
    del: <T>(p: string) => request<T>(apiUrl, 'DELETE', p, undefined, true),
    postPublic: <T>(p: string, b?: unknown) => request<T>(apiUrl, 'POST', p, b, false),
  };
}
