import { jwtHeaderSchema, jwtPayloadSchema } from './schema';
import type { JwtHeader, JwtPayload } from './schema';

/**
 * 从一枚访问令牌里读时限与身份，给一个必须知道凭据什么时候不能用的调用方。
 *
 * 签名**不**验证：一枚伪造的令牌换不来什么，因为授权发生在上游——真正做决定的是问上游（`userinfo`）。这里只服务
 * 上游自己没说时限的情况。
 */

/** 一枚令牌切成的三个线上部分，各自解码到解得出的程度。 */
export interface JwtToken {
  readonly header: JwtHeader;
  readonly payload: JwtPayload;
  /** 签名段原样——从不验证，只带着走，让读者看见整枚令牌。 */
  readonly signature: string;
}

/** 解出一段 base64url，容忍缺失的填充。 */
function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const normalized = remainder === 0 ? padded : padded + '='.repeat(4 - remainder);
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

/**
 * 令牌切成 `Header.Payload.Signature`，任何不是可解码三段令牌的东西（不透明令牌、坏 base64、头或载荷不是对象）都是
 * `undefined`。
 *
 * 签名按线路发来的原样交回；只有两段 JSON 被解码，每段都对着自己的 schema 检查、且每个键都可选，因此一枚带的东西比本库读的
 * 多的令牌仍能 parse。
 */
export function parseJwtToken(token: string): JwtToken | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return {
      header: jwtHeaderSchema.parse(decodeSegment(parts[0])),
      payload: jwtPayloadSchema.parse(decodeSegment(parts[1])),
      signature: parts[2],
    };
  } catch {
    return undefined;
  }
}

/**
 * 一枚访问令牌的载荷声明，任何不是可解码三段令牌的东西都是 `undefined`——正是 `parseJwtToken` 报告的那种，因此只读一部分的
 * 调用方不会被交到一枚可能被误当成整枚的半读令牌。
 */
export function readAccessTokenClaims(token: string): JwtPayload | undefined {
  return parseJwtToken(token)?.payload;
}

/** 声明里的 `exp` 折成 epoch 毫秒，令牌带着一个可用值的时候。 */
export function readAccessTokenExpiresAt(token: string): number | undefined {
  const exp = parseJwtToken(token)?.payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined;
  return Math.round(exp * 1000);
}
