/**
 * The credential side of the upstream: who the access token belongs to, and what a token grant answers.
 *
 * The two answers speak different languages, which is the point of keeping them apart here: `userinfo`
 * answers inside the smartsheet envelope but files the identity **directly** under `data` (both the
 * documentation and a live document agree, and it is the one endpoint whose `data` is not keyed by the
 * operation name), while the token endpoint answers with a bare body and no envelope at all — the same
 * body whichever of the two grants reached it.
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

/** What a token grant can be told to hand back; a lifetime left out leaves the reader to the token's `exp`. */
export interface TokenAnswerInput {
  accessToken: string;
  expiresIn?: number | undefined;
  userId?: string | undefined;
  refreshToken?: string | undefined;
}

/** The token endpoint's answer: an access token, and whatever else it cares to say. */
export function tokenAnswer(input: TokenAnswerInput): Record<string, unknown> {
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
export const tokenRefused: Record<string, unknown> = { error: 'invalid_grant', error_description: 'token grant rejected' };
