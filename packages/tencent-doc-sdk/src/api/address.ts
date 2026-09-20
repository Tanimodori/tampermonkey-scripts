/**
 * How a document coordinate becomes an address: the one place a Tencent Docs URL is built.
 *
 * Every sheet and record endpoint is addressed the same way (`/openapi/smartbook/v2/files/${fileID}/sheets/${sheetID}`),
 * and the segment encoding is the kind of detail that silently corrupts an id: file and sheet ids are
 * `[0-9A-Za-z$_-]` in the documented examples and must keep their literal `$`
 * (`300000000$ExAmPlEfIlEiD`), so only genuinely unsafe characters are escaped. The OAuth endpoints
 * carry their credential in the query string instead, which is why their addresses are built here too:
 * this is where a secret gets into a URL, and where it is kept out of every report.
 */

import type { CallRequest } from '@/client/request.js';

/** Which document, and which sub-sheet of it. */
export interface DocCoordinates {
  readonly fileId: string;
  readonly sheetId: string;
}

/** What a call is addressed to: the upstream's origin, and the ids inside the path. */
export interface EndpointTarget {
  readonly apiBase: string;
  readonly coordinates: DocCoordinates;
}

/** One path segment of a document coordinate, escaped without mangling the `$` and `:` the ids carry. */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%24/g, '$').replace(/%3A/gi, ':');
}

/** The origin and path a request is sent to — the two halves the transport takes. */
type Address = Pick<CallRequest, 'origin' | 'path'>;

function address(url: URL): Address {
  return { origin: url.origin, path: `${url.pathname}${url.search}` };
}

/** `…/files/${fileID}/sheets`: the document's own sub-sheet list. */
export function sheetsAddress(target: EndpointTarget): Address {
  const fileId = encodePathSegment(target.coordinates.fileId);
  return address(new URL(`/openapi/smartbook/v2/files/${fileId}/sheets`, target.apiBase));
}

/** `…/files/${fileID}/sheets/${sheetID}`: the one sub-sheet every record call addresses. */
export function sheetAddress(target: EndpointTarget): Address {
  const { fileId, sheetId } = target.coordinates;
  const base = `/openapi/smartbook/v2/files/${encodePathSegment(fileId)}/sheets`;
  return address(new URL(`${base}/${encodePathSegment(sheetId)}`, target.apiBase));
}

/**
 * An OAuth endpoint with its credential in the query string.
 *
 * The caller names the parameters in the upstream's own vocabulary (`access_token`, `client_secret`,
 * `refresh_token`); their values are secrets, which is why nothing downstream reports a path with its
 * query string attached.
 */
export function oauthAddress(apiBase: string, pathname: string, query: Record<string, string>): Address {
  const url = new URL(pathname, apiBase);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return address(url);
}
