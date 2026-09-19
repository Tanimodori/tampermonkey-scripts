/**
 * The credential side of the upstream: who the access token belongs to, and what a refreshed one looks
 * like.
 *
 * The two answers speak different languages, which is the point of keeping them apart here: `userinfo`
 * answers inside the smartsheet envelope but files the identity **directly** under `data` (both the
 * documentation and the live document agree, and it is the one endpoint whose `data` is not keyed by the
 * operation name), while the token endpoint answers with a bare body and no envelope at all.
 */

/** `UserInfoResponse`: the identity, measured fields included. */
export function userInfoAnswer(input: { openID: string; nick?: string }): Record<string, unknown> {
  return {
    ret: 0,
    msg: 'Succeed',
    data: {
      openID: input.openID,
      nick: input.nick ?? 'nickTest',
      avatar: 'https://example.com/avatar.png',
      source: 'qq',
      bindSource: '',
      fileAuthType: 'all',
      unionID: 'UnionIDTest',
    },
  };
}

/** The token endpoint's answer: a new access token, and whatever else it cares to say. */
export function refreshTokenAnswer(input: { accessToken: string; expiresIn?: number; userId?: string; refreshToken?: string }): Record<string, unknown> {
  return {
    access_token: input.accessToken,
    token_type: 'Bearer',
    ...(input.expiresIn === undefined ? {} : { expires_in: input.expiresIn }),
    scope: 'scope.smartsheet',
    user_id: input.userId ?? 'OpenIDTest',
    ...(input.refreshToken === undefined ? {} : { refresh_token: input.refreshToken }),
  };
}

/** A refusal from the token endpoint: still a body, worded by whoever called it. */
export const refreshTokenRefused: Record<string, unknown> = { error: 'invalid_grant', error_description: 'refresh token rejected' };
