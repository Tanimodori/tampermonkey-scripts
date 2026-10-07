import { z } from 'zod';

/**
 * 访问令牌本身是个 JWT，只读其中的声明，从不验签。
 *
 * 两段各自宽松：意外的头参数与没读的声明都留在视野里，一枚带的东西比本库读的多的令牌仍能 parse。
 */

/** 访问令牌的头段，只读不验（原因在 `token/jwt.ts`）。宽松，意外的头参数留在视野里。 */
export const jwtHeaderSchema = z.looseObject({ alg: z.string().optional(), typ: z.string().optional() });

/** 访问令牌的载荷段：本库读的身份与时限（`clt`、`exp`、`iat`、`sub`），每个键都可选。 */
export const jwtPayloadSchema = z.looseObject({
  clt: z.string().optional(),
  typ: z.unknown().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  sub: z.string().optional(),
});

export type JwtHeader = z.infer<typeof jwtHeaderSchema>;
export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
