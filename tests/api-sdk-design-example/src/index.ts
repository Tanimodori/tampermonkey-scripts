/**
 * 包的入口：两侧装配是两个可以分别不被命名的顶层绑定，无判定的那一份在声明处就带 `Raw` 后缀。
 *
 * 这一份的形状不是风格。命名 `listMessages` 就顺带把 `endpoint/schema.ts` 连 zod 一起收进产物，只命名 `listMessagesRaw` 就既不带它、
 * 也没有那套判定——细节与失效清单见 docs/validation-tiers.md。
 */
export * from './client';
export * from './error';
export * from './types';

export { listMessages } from './endpoint/verified';
export { listMessagesRaw } from './endpoint/raw';
