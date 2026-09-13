import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getFileSink, getRotatingFileSink } from '@logtape/file';
import { configureSync, disposeSync, getConsoleSink, getJsonLinesFormatter } from '@logtape/logtape';
import type { Sink } from '@logtape/logtape';
import { redactByField } from '@logtape/redaction';

/**
 * The logging conventions for this service, and the one place LogTape is configured.
 *
 * LogTape owns the mechanism: the configuration here provides the sinks, any module consumes a logger
 * by category (`getLogger(LOG_CATEGORY)`, or one of the child categories below), and a record no sink
 * accepts is dropped — with LogTape's own meta logger as the diagnostic for a missing or broken
 * configuration. Levels, the JSON Lines format and the credential redaction all come from the
 * library, so nothing here is hand-rolled.
 *
 * Every destination is configured the same way: one JSON line per record. The console sink is always
 * there — a container's log collector reads stdout and stderr — and `OPS_LOG_FILE_*` /
 * `OPS_LOG_ROTATING_FILE_*` add one file destination on top of it, which is what keeps the records
 * after the container is gone.
 */

/** The levels `OPS_SERVER_LOG_LEVEL` accepts, in LogTape's own vocabulary; the config schema reuses this list. */
export const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** The category every record from this service carries. */
export const LOG_CATEGORY = ['occult-pot-server'];

/**
 * The subsystems, as child categories.
 *
 * LogTape inherits a parent's sinks and lowest level, so naming them costs nothing at configuration
 * time and buys the ability to pick one subsystem's records out of the stream — `Configuration
 * resolved` from `Redis command answered` from a request line.
 */
export const LOG_CATEGORIES = {
  config: [...LOG_CATEGORY, 'config'],
  http: [...LOG_CATEGORY, 'http'],
  upstream: [...LOG_CATEGORY, 'upstream'],
  redis: [...LOG_CATEGORY, 'redis'],
  pots: [...LOG_CATEGORY, 'pots'],
} as const;

/**
 * Field names whose value could carry a credential; the value is replaced with `[redacted]`.
 *
 * Matching the *end* of a name is what keeps credential metadata readable: `accessToken` is
 * redacted, while `accessTokenLength` and `tokenExpiresInDays` are not. It only sees field *names*,
 * which is why a credential embedded in a value (a Redis URL, say) is the caller's job to take apart.
 */
const CREDENTIAL_FIELDS = [/token$/i, /secret$/i, /password$/i, /^auth(?:orization)?$/i, /^credentials?$/i, /^cookie$/i, /^set-cookie$/i, /^api-?key$/i];

/** `OPS_LOG_FILE_*`: one appended file, no rotation. */
export interface FileSinkConfig {
  readonly path?: string;
  readonly lazy?: boolean;
  readonly bufferSize?: number;
  readonly flushIntervalMs?: number;
}

/** `OPS_LOG_ROTATING_FILE_*`: one file that rotates once it reaches `maxSize`. */
export interface RotatingFileSinkConfig {
  readonly path?: string;
  readonly maxSize?: number;
  readonly maxFiles?: number;
  readonly bufferSize?: number;
  readonly flushIntervalMs?: number;
}

export interface ConfigureLoggingOptions {
  /** Where records go; defaults to one JSON line per record on the console. Replaces the console sink. */
  readonly sink?: Sink;
  /** The plain file destination; ignored when `rotatingFile` names a path. */
  readonly file?: FileSinkConfig;
  /** The rotating file destination. The configuration schema keeps the two paths exclusive. */
  readonly rotatingFile?: RotatingFileSinkConfig;
}

/**
 * Configures LogTape for this process. Called once by the composition root, before anything logs.
 *
 * The console sink picks its method by level, so `info` and below land on stdout while `warning` and
 * above land on stderr — the split the container's log collection expects. The meta logger shares
 * every sink at `warning`, which surfaces LogTape's own complaints without its "loggers are
 * configured" notice.
 *
 * @throws whatever a file destination throws while opening: a log path that cannot be written is a
 *   startup failure, not something to discover once the records are already missing.
 */
export function configureLogging(level: LogLevel, options: ConfigureLoggingOptions = {}): void {
  const formatter = getJsonLinesFormatter({ message: 'rendered', properties: 'flatten' });
  const consoleSink = options.sink ?? getConsoleSink({ formatter });
  const file = fileSink(options, formatter);

  // Redaction wraps each sink: a credential must be redacted in the file exactly as it is on the
  // console. `redactByField` passes a wrapped sink's disposal through, so `flushLogging()` still
  // flushes and closes the file.
  const sinks: Record<string, Sink> = { console: redact(consoleSink) };
  if (file !== undefined) sinks.file = redact(file);
  const destinations = Object.keys(sinks);

  configureSync({
    reset: true,
    sinks,
    loggers: [
      { category: LOG_CATEGORY, lowestLevel: level, sinks: destinations },
      { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: destinations },
    ],
  });
}

/**
 * Flushes and closes every sink. Call it before the process exits, on every path out.
 *
 * A console sink needs nothing, but a file sink buffers — 8 KB or 5 s, whatever the configuration
 * says — and `process.exit()` does not wait for it: without this the last records before a shutdown
 * are the ones that go missing.
 */
export function flushLogging(): void {
  disposeSync();
}

/** The configured file destination, or `undefined` when the environment named none. */
function fileSink(options: ConfigureLoggingOptions, formatter: ReturnType<typeof getJsonLinesFormatter>): Sink | undefined {
  const rotating = options.rotatingFile;
  if (rotating?.path !== undefined) {
    prepareDirectory(rotating.path);
    return getRotatingFileSink(rotating.path, {
      maxSize: rotating.maxSize,
      maxFiles: rotating.maxFiles,
      bufferSize: rotating.bufferSize,
      flushInterval: rotating.flushIntervalMs,
      formatter,
    });
  }

  const file = options.file;
  if (file?.path !== undefined) {
    prepareDirectory(file.path);
    return getFileSink(file.path, {
      lazy: file.lazy,
      bufferSize: file.bufferSize,
      flushInterval: file.flushIntervalMs,
      formatter,
    });
  }

  return undefined;
}

/**
 * Makes sure the directory the log file lives in is there.
 *
 * The image creates the path and compose mounts over it, so this is for the bare `node
 * dist/index.js` run: a missing directory is never the interesting failure, while an unwritable one
 * is — and that one still fails loudly when the sink opens the file.
 */
function prepareDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/** Wraps one sink so a credential never reaches it, whichever destination it is. */
function redact(sink: Sink): Sink {
  return redactByField(sink, { fieldPatterns: CREDENTIAL_FIELDS, action: () => '[redacted]' });
}

/**
 * Renders an epoch-millisecond instant as ISO 8601 UTC, the shape used for every
 * operator-facing instant (log records, `/readyz`).
 *
 * Instants are the only formatted values the service emits; the sheet's own derived display
 * columns are computed by the spreadsheet for human readers and never reach an API client.
 */
export function formatInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
