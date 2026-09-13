import { configureSync, getConsoleSink, getJsonLinesFormatter } from '@logtape/logtape';
import type { Sink } from '@logtape/logtape';
import { redactByField } from '@logtape/redaction';

/**
 * The logging conventions for this service, and the one place LogTape is configured.
 *
 * LogTape owns the mechanism: the configuration here provides the sink, any module consumes a logger
 * by category (`getLogger(LOG_CATEGORY)`), and a record no sink accepts is dropped — with LogTape's
 * own meta logger as the diagnostic for a missing or broken configuration. Levels, the JSON Lines
 * format and the credential redaction all come from the library, so nothing here is hand-rolled.
 */

/** The levels `OPS_SERVER_LOG_LEVEL` accepts, in LogTape's own vocabulary; the config schema reuses this list. */
export const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** The category every record from this service carries. */
export const LOG_CATEGORY = ['occult-pot-server'];

/**
 * Field names whose value could carry a credential; the value is replaced with `[redacted]`.
 *
 * Matching the *end* of a name is what keeps credential metadata readable: `accessToken` is
 * redacted, while `accessTokenLength` and `tokenExpiresInDays` are not.
 */
const CREDENTIAL_FIELDS = [/token$/i, /secret$/i, /password$/i, /^auth(?:orization)?$/i, /^credentials?$/i, /^cookie$/i, /^set-cookie$/i, /^api-?key$/i];

export interface ConfigureLoggingOptions {
  /** Where records go; defaults to one JSON line per record on the console. */
  readonly sink?: Sink;
}

/**
 * Configures LogTape for this process. Called once by the composition root, before anything logs.
 *
 * The console sink picks its method by level, so `info` and below land on stdout while `warning` and
 * above land on stderr — the split the container's log collection expects. The meta logger shares
 * that sink at `warning`, which surfaces LogTape's own complaints without its "loggers are
 * configured" notice.
 */
export function configureLogging(level: LogLevel, options: ConfigureLoggingOptions = {}): void {
  const target = options.sink ?? getConsoleSink({ formatter: getJsonLinesFormatter({ message: 'rendered', properties: 'flatten' }) });
  const sink = redactByField(target, { fieldPatterns: CREDENTIAL_FIELDS, action: () => '[redacted]' });

  configureSync({
    reset: true,
    sinks: { main: sink },
    loggers: [
      { category: LOG_CATEGORY, lowestLevel: level, sinks: ['main'] },
      { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: ['main'] },
    ],
  });
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
