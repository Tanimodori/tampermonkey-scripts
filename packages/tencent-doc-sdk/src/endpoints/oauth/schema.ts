import { z } from 'zod';

/**
 * 三个凭据端点的线上契约与入参：访问令牌属于谁，以及获得新令牌的两条路。
 *
 * 形状是**对着真实文档量出来的**（2026-09-19），不是照着文档猜的：`userinfo` 的身份**直接**落在 `data` 下；token 端点
 * 答复裸 body、没有信封，字段全部可选，被拒的答复也仍是一份要交出去的答复。
 */

/** `UserInfo`：访问令牌属于谁。只声明读到的 `openID`，其余字段留在宽松侧。 */
export const userInfoSchema = z.looseObject({ openID: z.string().optional(), nick: z.string().optional() });

/**
 * 任一 token 端点答复的东西：新访问令牌，以及它想说的别的。
 *
 * 无信封——这是本库用上游自己词汇读的答复。字段全部可选：`expires_in` 文档承诺了但不保证（调用方回落到令牌自己的 `exp`），
 * `refresh_token` 只在轮换它的流程里出现。
 */
export const tokenResponseSchema = z.looseObject({
  access_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  user_id: z.string().optional(),
});

/** 获取 Token：刚发给用户的 code，在它被签发的地址上兑换。 */
export const accessTokenInputSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  code: z.string().min(1),
  redirectUri: z.string().min(1),
});

/** 刷新 Token：手上这枚刷新令牌，答复可能把它换掉。 */
export const refreshTokenInputSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});

export type UserInfo = z.infer<typeof userInfoSchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
export type AccessTokenInput = z.infer<typeof accessTokenInputSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenInputSchema>;
