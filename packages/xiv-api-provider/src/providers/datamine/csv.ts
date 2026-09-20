/**
 * The SaintCoinach datamining CSV format, read as data.
 *
 * Every file under `ffxiv-datamining-mixed/<locale>/` looks like this:
 *
 * ```text
 * key,0,1,2,3
 * #,Name,Icon,Order{Minor}
 * int32,str,Image,byte
 * 0,"",0,0
 * 1,"格斗武器",60101,7
 * ```
 *
 * Tokenizing that is `csv-parse`'s job — quoted newlines, doubled quotes, CRLF and the BOM are all its
 * problem rather than ours. What is left here is the part no generic CSV reader can know about: the three
 * header lines exist, they are all the same width, and they are part of the file. So the parse answer is the
 * whole grid, header lines included, with nothing interpreted out of it — `./table.ts` turns that into
 * something addressable.
 *
 * One property of the header still needs saying: names are not stable enough to convert. `Item`'s second line
 * has empty entries where the sub-columns of an array live, and a brace suffix such as `Order{Minor}` is how
 * the same column is written as `OrderMinor` in the API. Both spellings are kept exactly as the file has them.
 */
import { parse } from 'csv-parse/sync';

/** One sheet exactly as its file holds it: every line of the grid, every cell a string. */
export interface SheetRawData {
  /** The file this came from, carried so a missing-column error and a built artifact can name their source. */
  readonly origin: string;
  /** The grid, header lines included: `data[0]` is the index line, `data[1]` the names, `data[2]` the types. */
  readonly data: readonly (readonly string[])[];
}

/** The three header lines every file starts with. */
export const HEADER_LINES = 3;

/**
 * Read one document into records.
 *
 * `bom: true` drops the byte-order mark, and `skip_empty_lines` keeps a trailing newline from becoming a
 * phantom row. An unterminated quoted field throws rather than swallowing the rest of the file, which is the
 * failure mode worth guarding: a silently truncated table looks exactly like a successful build.
 */
const tokenise = (text: string, origin: string): string[][] => {
  try {
    return parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, cast: false }) as string[][];
  } catch (error) {
    throw new Error(`${origin}: not readable as CSV — ${String(error)}`);
  }
};

/**
 * Parse one sheet's text into the grid it holds.
 *
 * The three header lines are validated rather than assumed. If upstream changes the format, producing
 * plausible-looking garbage silently is far worse than refusing to build, so a mismatch throws here — at the
 * point the bytes arrive, rather than at whatever later step first reads a name.
 *
 * Data rows are not checked. A row whose first cell is not an integer key is still a row: `#` is neither
 * monotonic nor contiguous, and converting it would be this package deciding what a column means.
 */
export const parseSheetCsv = (csv: string, origin = '<memory>'): SheetRawData => {
  const records = tokenise(csv, origin);

  if (records.length < HEADER_LINES) {
    throw new Error(`${origin}: expected at least ${HEADER_LINES} header records, found ${records.length}`);
  }

  const markerLine = records[0] as string[];
  const nameLine = records[1] as string[];
  const typeLine = records[2] as string[];

  if (markerLine[0] !== 'key') {
    throw new Error(`${origin}: first header line must start with "key", found ${JSON.stringify(markerLine[0])}`);
  }
  if (nameLine[0] !== '#') {
    throw new Error(`${origin}: second header line must name the key column "#", found ${JSON.stringify(nameLine[0])}`);
  }
  if (nameLine.length !== typeLine.length || markerLine.length !== nameLine.length) {
    // All three lines have to describe the same columns. Checking only the last two lets a header whose
    // index row is longer than its name row through, and every column after the shortfall then reads as
    // missing rather than misaligned — which is the quiet failure this file exists to avoid.
    throw new Error(`${origin}: header width mismatch — ${markerLine.length} indices, ${nameLine.length} names, ${typeLine.length} types`);
  }

  return { origin, data: records };
};
