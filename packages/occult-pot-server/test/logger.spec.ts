import { getLogger } from '@logtape/logtape';
import { describe, expect, it } from 'vitest';
import { formatInstant, LOG_CATEGORY } from '@/logger.ts';
import { captureLogs } from './helpers.ts';

/**
 * These pin this service's logging conventions: the level an operator writes in `SERVER_LOG_LEVEL`, the
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
