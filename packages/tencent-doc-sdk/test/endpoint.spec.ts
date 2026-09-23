import { getRecordsAnswer, getSheetAnswer, rawRecord, tokenAnswer, userInfoAnswer, writtenRecordsAnswer } from '@test/testUtils/document';
import { describe, expect, it } from 'vitest';
import { defineEndpoint, endpoints } from '@/index';
import { pathPlaceholders } from '@/path';
import { sheetParamsSchema } from '@/validation/schemas';

/**
 * The declarations, checked as data.
 *
 * An endpoint is a value now, so the whole set can be walked — which is the one class of mistake a
 * template can otherwise carry silently. `pupa` only discovers a placeholder nothing fills when a call is
 * made, and by then the address it would have built is the thing at fault: these cases find it at the desk
 * instead, by asking each `path` what it names and whether the schema beside it can say those things.
 */

/** The keys a declared `params` schema accepts, or nothing where an endpoint takes no coordinates. */
function accepts(endpoint: unknown): string[] {
  const shape = (endpoint as { params?: { shape?: Record<string, unknown> } }).params?.shape;
  return shape === undefined ? [] : Object.keys(shape);
}

/** The top-level keys a declared `body` schema accepts, which is where the keyword lives. */
function bodyKeys(endpoint: unknown): string[] {
  const shape = (endpoint as { body?: { shape?: Record<string, unknown> } }).body?.shape;
  return shape === undefined ? [] : Object.keys(shape);
}

const everyCall = Object.entries(endpoints);

describe('every declaration', () => {
  it('names a placeholder its params schema can fill', () => {
    for (const [name, endpoint] of everyCall) {
      for (const placeholder of pathPlaceholders(endpoint.path)) {
        expect(accepts(endpoint), `${name} addresses {${placeholder}} with no schema for it`).toContain(placeholder);
      }
    }
  });

  it('is addressed under the upstream’s own paths, and nowhere else', () => {
    expect([...new Set(everyCall.map(([, endpoint]) => endpoint.path))].sort()).toEqual([
      '/oauth/v2/token',
      '/oauth/v2/userinfo',
      '/openapi/smartbook/v2/files/{fileId}/sheets',
      '/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}',
    ]);
  });

  it('sends a body only where the upstream reads one, and that body is wrapped in its own keyword', () => {
    // The two facts are the same fact: a record call's body is `{ <operation>: … }`, so a body that exists
    // and a keyword that does not match `operation` would be a call the upstream answers as no operation.
    for (const [name, endpoint] of everyCall) {
      expect(bodyKeys(endpoint), name).toEqual(endpoint.body === undefined ? [] : [endpoint.operation]);
    }
  });
});

describe('defineEndpoint', () => {
  const base = {
    operation: 'example',
    path: '/example',
    response: { schema: sheetParamsSchema },
  } as const;

  it('fills the shape every call in this package shares', () => {
    const endpoint = defineEndpoint(base);

    expect(endpoint.method).toBe('POST');
    expect(endpoint.auth).toBe('headers');
    expect(endpoint.response.envelope).toBe(true);
  });

  it('lets a declaration say where it departs, and only that', () => {
    const endpoint = defineEndpoint({ ...base, method: 'GET', auth: 'none', response: { schema: sheetParamsSchema, envelope: false } });

    expect(endpoint.method).toBe('GET');
    expect(endpoint.auth).toBe('none');
    expect(endpoint.response.envelope).toBe(false);
  });

  it('carries the schemas through untouched, since checking them is the pipeline’s business', () => {
    const endpoint = defineEndpoint(base);

    expect(endpoint.response.schema).toBe(sheetParamsSchema);
    expect(endpoint.params).toBeUndefined();
    expect(endpoint.query).toBeUndefined();
  });

  it('adds no unwrap of its own, so an absent one means the whole answer is the result', () => {
    expect(defineEndpoint(base).response.unwrap).toBeUndefined();
  });
});

describe('what each endpoint hands back', () => {
  // Each of these is the answer one measured endpoint gives, and the one part of it the caller is given.
  // The point is that the projection is stated where the contract is: an endpoint that reads
  // `data.getRecords` cannot quietly start answering `data.addRecords`.

  it('reads a page out of the section the keyword filed it under', () => {
    const answer = getRecordsAnswer({ records: [rawRecord({ recordId: 'r00001' })], total: 1, hasMore: false, next: 1 });

    expect(endpoints.getRecords.response.unwrap?.(answer)).toMatchObject({ total: 1, next: 1 });
  });

  it('reads the sub-sheets out of theirs', () => {
    const answer = getSheetAnswer([{ sheetID: 'tXXXXXX', title: '智能表1' }]);

    expect(endpoints.getSheetList.response.unwrap?.(answer)).toEqual([{ sheetID: 'tXXXXXX', title: '智能表1' }]);
  });

  it('reads the rows a write touched out of theirs', () => {
    const answer = writtenRecordsAnswer('addRecords', [{ recordID: 'rNew1', values: { ID: 'K-0002' } }]);

    // `autoRawRecords` and friends ride along: the write answer carries columns nothing here reads, and the
    // schema is loose precisely so that they stay visible to whoever is looking at the answer.
    expect(endpoints.addRecords.response.unwrap?.(answer)).toMatchObject({ records: [{ recordID: 'rNew1', values: { ID: 'K-0002' } }] });
  });

  it('reads nothing at all from a deletion, which is what a deletion answers with', () => {
    expect(endpoints.deleteRecords.response.unwrap?.({ ret: 0, msg: 'Succeed' })).toBeUndefined();
  });

  it('reads the identity out of `data` itself, where userinfo files it directly', () => {
    const answer = userInfoAnswer({ openID: 'test-open-id', nick: 'tester' });

    expect(endpoints.userinfo.response.unwrap?.(answer)).toMatchObject({ openID: 'test-open-id' });
  });

  it('hands a token answer over whole, because it has no envelope to read a section out of', () => {
    const answer = tokenAnswer({ accessToken: 'fresh', expiresIn: 2_592_000, userId: 'u' });

    expect(endpoints.accessToken.response.unwrap).toBeUndefined();
    expect(endpoints.refreshToken.response.envelope).toBe(false);
    expect(endpoints.refreshToken.response.schema.parse(answer)).toMatchObject({ access_token: 'fresh' });
  });
});
