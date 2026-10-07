/**
 * 这个 provider 的常数，两类：文件的形状，与上游的地址。
 *
 * 它们住在一个不引用任何别的东西的模块里，因为地址那几项两边都要用——`@/endpoints/index.ts` 拼 URL，
 * `@/client/client.ts` 给时限，`@/endpoints/raw.ts` 写失败消息——而那几个模块彼此有引用关系。
 */

/** 每个文件开头那三行表头。 */
export const HEADER_LINES = 3;

/** 仓库的默认分支，按名字寻址所以不会过期。 */
export const DEFAULT_REF = 'HEAD';

/** `InfSein/ffxiv-datamining-mixed` */
export const DATAMINING_REPOSITORY = 'InfSein/ffxiv-datamining-mixed';

/** 简体中文，两个 userscript 需要的语种。 */
export const DEFAULT_LOCALE = 'chs';

/** 这里的表能到 19 MB，这条传输等得比 API provider 久。 */
export const DEFAULT_TIMEOUT_MS = 30_000;
