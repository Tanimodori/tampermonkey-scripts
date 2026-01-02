import { ImportMeta, ImportMetaEnv } from 'vite/client';

declare module '*.css?inline' {
  declare const style: string;
  export default style;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
