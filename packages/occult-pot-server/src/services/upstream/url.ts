/**
 * The address half of a Tencent Docs smartsheet call: how a document coordinate becomes a path.
 *
 * One place, because every endpoint of the record and sheet API is addressed the same way
 * (`/openapi/smartbook/v2/files/${fileID}/sheets/${sheetID}`), and the segment encoding is the kind of
 * detail that silently corrupts an id: file and sheet ids are `[0-9A-Za-z$_-]` in the documented
 * examples and must keep their literal `$` (`300000000$ExAmPlEfIlEiD`), so only genuinely unsafe
 * characters are escaped.
 */

/** One path segment of a document coordinate, escaped without mangling the `$` and `:` the ids carry. */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%24/g, '$').replace(/%3A/gi, ':');
}
