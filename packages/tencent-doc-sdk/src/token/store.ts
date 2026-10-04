import { TencentDocsError } from '@/error';
import { parseJwtToken } from './jwt';

/**
 * 一个文档被打开时用的凭据，以及它的同步持有者。
 *
 * 这就是本库对自己以谁的身份调用所知道的全部：一枚访问令牌、它被签发给的 client、它归属的 Open-Id，以及能换掉它的
 * 刷新令牌。这里没有异步，也不和上游说话——改动凭据的端点是 `token/manager.ts`，而且它们**通过**这份 store 去改，
 * 因此每一个读它的人（首当其冲是上面的文档 client）都看得到变化，不需要被接到做出改动的那一方上。
 *
 * 凭据在这个进程之外放哪儿是调用方自己的事：`set()` 是一次重启后把它载回来的方式，`get()` 是要写出去的那份快照。
 * `clientSecret` 刻意不是两者任何一个的字段：它是从不离开被配置进来的那个环境的一半，一份能带上它的记录就是一份
 * 有人会把它写到某处的记录。
 *
 * 对一份凭据问两类问题，问法不同。`get()` 答「现在持有什么」，某个部分缺席本身就是答案，什么都不抛。四个读取
 * ——`getAccessToken()`、`getClientId()`、`getRefreshToken()`、`getAuthHeaders()`——答「这次调用到底出不出得去」：
 * 因为缺一个部分而发不出的调用是一起配置失败，就要按失败报出来，而不是交回 `undefined` 让调用方自己发现。
 * 决定要不要续期、下个进程要写出去什么，问第一类；发送，问第二类。
 */

/**
 * 关于一份凭据持有什么：够发一次调用，也够一次重启后恢复它。
 *
 * 每个字段都可选，因为 `get()` 答的是此刻持有的东西，而一个部分可能只是还没被说过——空 store 没有令牌，刷新答复可能不
 * 说时限，userinfo 可能不说 Open-Id。一个部分缺席是信息，不是错误；它变成错误的地方在上面那几个读取里。
 *
 * 令牌能替自己说的三个部分（`openId` 来自 `sub`、`expiresAt` 来自 `exp`、`issueAt` 来自 `iat`）在令牌被写进来的那一刻
 * 就解析好并持有，因此 `get()` 从不重新解析它。
 */
export interface CredentialRecord {
  readonly accessToken?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly openId?: string | undefined;
  readonly clientId?: string | undefined;
  /** `accessToken` 失效的时刻，epoch 毫秒，已知的话。 */
  readonly expiresAt?: number | undefined;
  /** `accessToken` 被签发的时刻，epoch 毫秒，已知的话。 */
  readonly issueAt?: number | undefined;
}

/**
 * 凭据，以及一次调用需要问它要的东西。
 *
 * `get()` 是持有内容的一份朴素投影；`set(record)` 把一份局部合并在它上面——记录没说的字段保持原值——并在访问令牌被
 * 替换时重算令牌派生的部分。四个读取接着讲明某次调用缺了哪个部分就出不去：Open API 要求的三件套头、OAuth 的
 * `userinfo` 被问起的那枚访问令牌、两个授权用来点名自己应用的 `client_id`，以及让刷新成为可能的刷新令牌。
 * 没有 `getOpenId()`：在这个头之外 Open-Id 哪儿都不去，只想看看它的调用方读 `get().openId`。
 */
export interface CredentialStore {
  get(): CredentialRecord;
  set(record: Partial<CredentialRecord>): void;
  /** 每个 Open API 调用都带的三件套。缺任何一个都是 `config`。 */
  getAuthHeaders(): { 'Access-Token': string; 'Client-Id': string; 'Open-Id': string };
  /** 调用用的访问令牌。凭据一个都没有时是 `config`。 */
  getAccessToken(): string;
  /** 令牌被签发给的 `client_id`。从没人说过就是 `config`。 */
  getClientId(): string;
  /** 能换掉访问令牌的刷新令牌。没得换就是 `config`。 */
  getRefreshToken(): string;
}

/**
 * store 自己的状态：明说的部分，与从访问令牌读出、放在旁边的部分并存。
 *
 * 字面值与派生值从不共用一个字段，因为它们的寿命不同：配置的 Open-Id 穿过每一次刷新都活着，而声明派生的值属于读出它的
 * 那枚令牌，令牌一被替换就重算。`get()` 答 `literal ?? derived`，这就是读取的全部——没有解析。
 */
interface CredentialStoreState {
  readonly accessToken?: string | undefined;
  readonly clientId?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly openId?: string | undefined;
  readonly expiresAt?: number | undefined;
  readonly issueAt?: number | undefined;
  readonly tokenOpenId?: string | undefined;
  readonly tokenExpiresAt?: number | undefined;
  readonly tokenIssueAt?: number | undefined;
}

/** 一个持有被给内容的 store。初始记录漏掉的每个部分都保持未知，直到被说出来。 */
export function createCredentialStore(initial?: Partial<CredentialRecord>): CredentialStore {
  let state: CredentialStoreState = {};

  /**
   * `record` 逐字段盖在 `state` 上，记录没说的字段保持原样。
   *
   * 缺席、空字符串与一个不是数的数，都表示「没说」而不是「清掉」：合并后的记录正是刷新只发了一枚新访问令牌之后要写回
   * 调用方存储的东西——把让这次刷新成为可能的刷新令牌丢掉，等于终止这份凭据。
   *
   * 三个令牌派生的部分在访问令牌真的被替换时才读一次：新令牌的到期与签发时间是它自己说的（旧的随它一起脱掉），
   * 而明说的 Open-Id 保持不变，只有在从没人说过时才落到新令牌的 `sub` 上。
   */
  function set(record: Partial<CredentialRecord>): void {
    const token = text(record.accessToken);
    const replacing = token !== undefined && token !== state.accessToken;
    const claims = replacing ? parseJwtToken(token) : undefined;
    state = {
      accessToken: token ?? state.accessToken,
      clientId: text(record.clientId) ?? state.clientId,
      openId: text(record.openId) ?? state.openId,
      refreshToken: text(record.refreshToken) ?? state.refreshToken,
      // 字面时限是令牌自己说的；被带到替换后的令牌上只会读错新的那一个，因此替换令牌而不说时限就是丢掉到期与签发时间。
      expiresAt: finite(record.expiresAt) ?? (replacing ? undefined : state.expiresAt),
      issueAt: finite(record.issueAt) ?? (replacing ? undefined : state.issueAt),
      tokenOpenId: replacing ? text(claims?.payload.sub) : state.tokenOpenId,
      tokenExpiresAt: replacing ? epochMs(claims?.payload.exp) : state.tokenExpiresAt,
      tokenIssueAt: replacing ? epochMs(claims?.payload.iat) : state.tokenIssueAt,
    };
  }

  set(initial ?? {});

  function held(value: string | undefined, what: string, hint: string): string {
    return value === undefined || value.length === 0 ? missing(what, hint) : value;
  }

  return {
    get: () => ({
      accessToken: state.accessToken,
      clientId: state.clientId,
      openId: state.openId ?? state.tokenOpenId,
      refreshToken: state.refreshToken,
      expiresAt: state.expiresAt ?? state.tokenExpiresAt,
      issueAt: state.issueAt ?? state.tokenIssueAt,
    }),
    set,
    getAuthHeaders: () => ({
      'Access-Token': held(state.accessToken, 'access token', 'nothing has been loaded into the store yet'),
      'Client-Id': held(state.clientId, 'client id', 'neither the configuration nor an answer carried one'),
      'Open-Id': held(state.openId ?? state.tokenOpenId, 'Open-Id', 'none was configured, and the access token carries no `sub` claim to read one from'),
    }),
    getAccessToken: () => held(state.accessToken, 'access token', 'nothing has been loaded into the store yet'),
    getClientId: () => held(state.clientId, 'client id', 'neither the configuration nor an answer carried one'),
    getRefreshToken: () => held(state.refreshToken, 'refresh token', 'the upstream never handed one out, and none was configured'),
  };
}

function missing(what: string, hint: string): never {
  throw new TencentDocsError('config', `The credential has no ${what} to call with: ${hint}`);
}

const text = (value: string | undefined): string | undefined => (value === undefined || value.length === 0 ? undefined : value);

const finite = (value: number | undefined): number | undefined => (value === undefined || !Number.isFinite(value) ? undefined : value);

/** 一个 JWT 数值时间戳（秒，可含小数）折成 epoch 毫秒，或 `undefined`。 */
const epochMs = (seconds: number | undefined): number | undefined =>
  seconds !== undefined && Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
