import type { Dispatcher } from 'undici';
import { getConfig } from '@/config.ts';
import { useClient } from '../client.ts';
import { asRecord, parseBody } from '../interceptors/classify.ts';
import type { CallOptions } from '../interceptors/classify.ts';
import { throttle } from '../throttle.ts';

/**
 * The OAuth endpoints: who the credential belongs to, and how a refresh token becomes an access
 * token.
 *
 * They speak their own vocabulary — `userinfo` answers with the smartsheet envelope, the token
 * endpoint answers with the token itself and no envelope at all — which is why each function says
 * so on its request rather than leaving the classifier to guess. The credential lives in
 * `stores/upstream.ts`; this module only performs the two calls.
 *
 * This module holds its own client: `sheet.ts` has one of its own, and neither is a process-wide
 * singleton.
 *
 * See https://docs.qq.com/open/document/app/oauth2/refresh_token.html
 */

/** The credential a token refresh needs; the secret never leaves the environment. */
export interface RefreshTokenInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** The credential's own identity, as `/oauth/v2/userinfo` reports it; the caller reads `openID`. */
export async function getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
  const body = await send({
    ...target(apiUrl('/oauth/v2/userinfo', { access_token: accessToken })),
    method: 'GET',
    headers: {},
    operation: 'userinfo',
    envelope: true,
  });
  return asRecord(unwrap(body, 'userinfo'));
}

/** Exchanges a refresh token for a new access token. No envelope: the answer is the token itself. */
export async function refreshAccessToken(input: RefreshTokenInput): Promise<Record<string, unknown>> {
  const url = apiUrl('/oauth/v2/token', {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
  return asRecord(await send({ ...target(url), method: 'GET', headers: {}, operation: 'refreshToken', envelope: false }));
}

/**
 * This module's transport, built on first use: it reads the loaded configuration for its timeouts,
 * which does not exist yet while modules are being imported.
 */
let built: Dispatcher | undefined;

function client(): Dispatcher {
  return (built ??= useClient());
}

/** Runs one call under the shared pacing and hands back its parsed body. */
async function send(options: CallOptions): Promise<unknown> {
  const response = await throttle(() => client().request(options));
  return parseBody(await response.body.text());
}

/** The section an envelope names, or the whole `data` when it names nothing. */
function unwrap(body: unknown, operation: string): unknown {
  const data = asRecord(asRecord(body).data);
  return data[operation] ?? data;
}

/** An absolute URL split the way undici wants it. */
function target(url: string): { origin: string; path: string } {
  const parsed = new URL(url);
  return { origin: parsed.origin, path: `${parsed.pathname}${parsed.search}` };
}

/** An absolute URL on the configured origin, e.g. the user-info or token endpoint. */
function apiUrl(pathname: string, params: Record<string, string> = {}): string {
  const url = new URL(pathname, getConfig().docs.apiBase);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}
