import { describe, expect, it } from 'vitest';
import type { ListMessagesInput, ListMessagesOutput } from '@/endpoint/schema';
import { createApi, listMessages, listMessagesRaw } from '@/index';
import type { Endpoint } from '@/types';
import { API_BASE, GOOD_OUTPUT, INPUT, TOKEN } from './fixtures';

/**
 * 注册表审计：把动词与凭据的放法从声明字段移进适配器之后，这类错误唯一的去处。
 *
 * 类型不再阻止一个 endpoint 忘记带 JWT、忘记编码，也不再保证两份装配发出同样的字节——这些性质现在只有在这里才看得见。这里的
 * 注册表是一个 endpoint 的两件装配；再加 endpoint 时把它们列进 `registry` 就好。
 */

type Tier = Endpoint<ListMessagesInput, ListMessagesOutput>;

const registry: Tier[] = [listMessages, listMessagesRaw];
const client = createApi({ apiBase: API_BASE, token: TOKEN });

describe('一整套 endpoint', () => {
  it('两份装配说的是同一次调用，而注册表里不出现第二个 operation', () => {
    expect(listMessages.operation).toBe(listMessagesRaw.operation);
    expect(new Set(registry.map((endpoint) => endpoint.operation))).toEqual(new Set(['listMessages']));
  });

  it('每一份交出的 init 都带着那一个 JWT 头字段', () => {
    for (const endpoint of registry) {
      expect(endpoint.requestAdaptor(client, INPUT).init.headers).toMatchObject({ Authorization: 'Bearer a.jwt.token' });
    }
  });

  it('每一份产出的 `url` 都是一个绝对地址，且含 `&`、`=` 与空格的游标仍旧是一个键、一个值', () => {
    for (const endpoint of registry) {
      const url = new URL(endpoint.requestAdaptor(client, { before: 'a b&c=1' }).url);
      expect([...url.searchParams.keys()]).toEqual(['before']);
      expect(url.searchParams.get('before')).toBe('a b&c=1');
    }
  });

  it('两份装配对同一份入参发出完全相同的字节', () => {
    expect(listMessages.requestAdaptor(client, INPUT)).toEqual(listMessagesRaw.requestAdaptor(client, INPUT));
  });

  it('两个适配器是同一个函数对象，所以它们不会各自漂移', () => {
    expect(listMessages.requestAdaptor).toBe(listMessagesRaw.requestAdaptor);
    expect(listMessages.responseAdaptor).toBe(listMessagesRaw.responseAdaptor);
  });

  it('一份 schema 供两装配用时 output 等于 input', () => {
    expect(listMessages.requestSchema?.parse(INPUT)).toEqual(INPUT);
    expect(listMessages.responseSchema?.parse(GOOD_OUTPUT)).toEqual(GOOD_OUTPUT);
  });
});
