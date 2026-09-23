import pupa from 'pupa';

/**
 * How a document coordinate becomes a path: the one place a Tencent Docs path is interpolated.
 *
 * `pupa` is the template engine, so an endpoint states its address the way the documentation does
 * (`/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}`) and nothing downstream reassembles it from
 * fragments. Two details of this upstream make the template worth having at all: file and sheet ids are
 * `[0-9A-Za-z$_-]` in the documented examples and keep a literal `$` (`300000000$ExAmPlEfIlEiD`), and a
 * coordinate is the only thing that varies between the five smartsheet calls — four of them share one
 * address and differ by nothing but the request body.
 *
 * The encoding is done here rather than by each caller, and it is done *as a value is substituted*
 * (`transform`) rather than on the assembled string. `pupa` interpolates and nothing else, so a value
 * containing `/`, `#` or `?` would otherwise open a new segment, drop the query, or escape the origin —
 * and encoding the finished path instead would take the `$` and `:` the ids carry along with it. So: every
 * value that reaches a path is a path segment first, and the template's own punctuation is never touched.
 *
 * The query string is not this function's business: it is written with `URLSearchParams#set`, which encodes
 * on its own terms. Two encoders, each correct for the one thing it encodes — a path segment and a query
 * parameter do not agree on what must be escaped.
 */

/**
 * Which document, and which sub-sheet of it.
 *
 * A type alias rather than an interface so that it carries an implicit index signature and is directly
 * usable as `PathParams`: the coordinates a client is configured with *are* the placeholders its document
 * endpoints fill, and saying so here saves a cast at every place the two meet.
 */
export type DocCoordinates = { readonly fileId: string; readonly sheetId: string };

/** The values a path template may name. Keys are the placeholders, so they are identifiers. */
export type PathParams = Readonly<Record<string, string>>;

/** One path segment of a document coordinate, escaped without mangling the `$` and `:` the ids carry. */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%24/g, '$').replace(/%3A/gi, ':');
}

/**
 * The template with its placeholders replaced by encoded values.
 *
 * `pupa` throws `MissingValueError` for a placeholder the params do not carry, which is what makes a
 * template and a schema that disagree on a name fail as this package's own `config` error rather than as a
 * request to an address nobody meant. The guard below is what preserves that: `transform` runs *before*
 * the missing-value check, so passing every value through `String` would turn an absent coordinate into the
 * literal text `undefined` and send it.
 */
export function buildPath(template: string, params: PathParams): string {
  return pupa(template, params, {
    transform: ({ value }) => (value === undefined ? undefined : encodePathSegment(String(value))),
  });
}

/** The placeholders a template names, in order of appearance and without repeats. */
export function pathPlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]))];
}
