import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLogger } from '@logtape/logtape';
import { captureLogs } from '@test/testUtils/helpers.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { configureLogging, flushLogging, formatInstant, formatTimestamp, LOG_CATEGORY, LOG_CATEGORIES } from '@/logger.ts';

/**
 * These pin this service's logging conventions: the level an operator writes in `OPS_SERVER_LOG_LEVEL`, the
 * category every record carries, and which fields must never reach a line. The transport itself
 * (sinks, the JSON Lines format, the meta logger) is LogTape's, not ours to test.
 */

describe('configureLogging', () => {
  it('sends a record from the service category to the configured sink', () => {
    const records = captureLogs();

    getLogger(LOG_CATEGORY).info('hello', { requestId: 'abc', status: 200 });

    expect(records).toEqual([{ level: 'info', message: 'hello', requestId: 'abc', status: 200 }]);
  });

  it('logs at the level an operator configured, warning included', () => {
    const records = captureLogs('warning');

    const logger = getLogger(LOG_CATEGORY);
    logger.debug('nope');
    logger.info('nope');
    logger.warning('yes');
    logger.error('yes');

    expect(records).toEqual([
      { level: 'warning', message: 'yes' },
      { level: 'error', message: 'yes' },
    ]);
  });

  it('drops records below the configured level', () => {
    const records = captureLogs('error');

    getLogger(LOG_CATEGORY).warning('nope');

    expect(records).toEqual([]);
  });

  it('redacts values whose field name could carry a credential', () => {
    const records = captureLogs();

    getLogger(LOG_CATEGORY).info('auth', {
      accessToken: 'secret-value',
      refresh_token: 'secret-value',
      clientSecret: 'secret-value',
      password: 'secret-value',
      authorization: 'secret-value',
      apiKey: 'secret-value',
      cookie: 'secret-value',
    });

    expect(records).toHaveLength(1);
    const record = records[0]!;
    for (const value of Object.values(record)) expect(value).not.toBe('secret-value');
    expect(record).toMatchObject({
      accessToken: '[redacted]',
      refresh_token: '[redacted]',
      clientSecret: '[redacted]',
      password: '[redacted]',
      authorization: '[redacted]',
      apiKey: '[redacted]',
      cookie: '[redacted]',
    });
  });

  it('keeps credential metadata visible so operators can see token health', () => {
    const records = captureLogs();

    getLogger(LOG_CATEGORY).info('startup', { accessTokenLength: 412, accessTokenExpiresAt: '2026-10-11T15:31:33.000Z', tokenExpiresInDays: 29.3 });

    expect(records[0]).toMatchObject({
      accessTokenLength: 412,
      accessTokenExpiresAt: '2026-10-11T15:31:33.000Z',
      tokenExpiresInDays: 29.3,
    });
  });
});

describe('formatInstant', () => {
  it('renders an epoch instant as ISO 8601 UTC for operator-facing fields', () => {
    expect(formatInstant(1_791_732_693_000)).toBe('2026-10-11T15:31:33.000Z');
    expect(formatInstant(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('formatTimestamp', () => {
  it('renders the instant in the named zone, offset included', () => {
    // 2026-09-12T08:00:00Z, read from four places: east of UTC, UTC itself, a half-hour zone and one
    // on daylight time.
    expect(formatTimestamp(1_789_200_000_000, 'Asia/Shanghai')).toBe('2026-09-12T16:00:00.000+08:00');
    expect(formatTimestamp(1_789_200_000_000, 'UTC')).toBe('2026-09-12T08:00:00.000+00:00');
    expect(formatTimestamp(1_789_200_000_000, 'Asia/Kolkata')).toBe('2026-09-12T13:30:00.000+05:30');
    expect(formatTimestamp(1_789_200_000_000, 'America/New_York')).toBe('2026-09-12T04:00:00.000-04:00');
  });
});

describe('the file sinks', () => {
  const directories: string[] = [];

  /** A throwaway directory per case; the sink writes real files, and nothing may land in the repo. */
  function temporaryDirectory(): string {
    const dir = mkdtempSync(join(tmpdir(), 'occult-pot-log-'));
    directories.push(dir);
    return dir;
  }

  /** One JSON Lines record per line, as the file sink writes them. */
  function recordsIn(file: string): Array<Record<string, unknown>> {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  afterEach(() => {
    flushLogging();
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes the same JSON Lines to a file as to the console, credentials redacted', () => {
    const path = join(temporaryDirectory(), 'nested', 'app.log');

    // The directory does not exist yet: the sink creates it rather than failing at startup. The
    // console sink is silenced so the case says nothing on stdout.
    configureLogging('info', { sink: () => undefined, file: { path, bufferSize: 0 } });
    getLogger(LOG_CATEGORIES.redis).info('Redis command answered', { command: 'GET', accessToken: 'secret-value' });

    const [record] = recordsIn(path);
    expect(record).toMatchObject({
      // LogTape's own fields, in its own vocabulary: the level is uppercase and the category is the
      // dot-joined `logger`.
      level: 'INFO',
      logger: 'occult-pot-server.redis',
      message: 'Redis command answered',
      command: 'GET',
      accessToken: '[redacted]',
    });
    expect(readFileSync(path, 'utf8')).not.toContain('secret-value');
  });

  it('rotates once the active file reaches its size bound', () => {
    const dir = temporaryDirectory();
    const path = join(dir, 'rotating.log');

    configureLogging('info', { sink: () => undefined, rotatingFile: { path, maxSize: 400, maxFiles: 2, bufferSize: 0 } });
    const logger = getLogger(LOG_CATEGORIES.upstream);
    for (let index = 0; index < 20; index += 1) logger.info('Tencent Docs call answered', { operation: 'getRecords', index, padding: 'x'.repeat(80) });

    // `maxFiles` bounds the backups: the active file plus `.1` and `.2`, however many rotations ran.
    expect(readdirSync(dir).sort()).toEqual(['rotating.log', 'rotating.log.1', 'rotating.log.2']);
  });

  it('flushes what is still buffered when the process is about to stop', () => {
    const path = join(temporaryDirectory(), 'buffered.log');

    // Default buffering: a record larger than LogTape's small-record fast path stays in the buffer,
    // which is exactly the window `flushLogging()` closes before `process.exit()`.
    configureLogging('info', { sink: () => undefined, file: { path } });
    getLogger(LOG_CATEGORY).info('Starting occult-pot-server', { padding: 'x'.repeat(500) });
    flushLogging();

    expect(recordsIn(path)).toHaveLength(1);
  });

  it('leaves @timestamp as LogTape writes it, and adds no local field, while the zone is UTC', () => {
    const path = join(temporaryDirectory(), 'utc.log');

    configureLogging('info', { sink: () => undefined, file: { path, bufferSize: 0 } });
    getLogger(LOG_CATEGORY).info('hello');

    const [record] = recordsIn(path);
    expect(record?.['@timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(record).not.toHaveProperty('timestampLocal');
  });

  it('adds timestampLocal beside the UTC instant once a zone is configured', () => {
    const path = join(temporaryDirectory(), 'shanghai.log');

    configureLogging('info', { sink: () => undefined, file: { path, bufferSize: 0 }, timezone: 'Asia/Shanghai' });
    getLogger(LOG_CATEGORY).info('hello');

    const [record] = recordsIn(path);
    // The machine-readable instant is untouched; the local rendering sits next to it.
    expect(record?.['@timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(record?.timestampLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/);
    // And the field order is the readable one: the UTC instant, then the local one.
    expect(Object.keys(record ?? {}).slice(0, 2)).toEqual(['@timestamp', 'timestampLocal']);
  });

  it('creates no file when no destination is configured', () => {
    const dir = temporaryDirectory();

    configureLogging('info', { sink: () => undefined });

    expect(readdirSync(dir)).toEqual([]);
  });
});
