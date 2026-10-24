// Vite 在构建时把 `?inline` 解析成 CSS 字符串；TypeScript 不解析这个后缀，这里局部忽略。
// @ts-ignore
import css from './index.css?inline';

export default css as string;
