import { whenNodeReady } from './hooks/dom';
import { injectWindow } from './hooks/tooltip';
import injectedStyle from './styles/index.css?inline';

export const injectCss = (doc: Document = document): void => {
  const styleSheet = doc.createElement('style');
  styleSheet.setAttribute('type', 'text/css');
  styleSheet.innerHTML = injectedStyle;
  // document-start 时 head 尚未解析出来，直接 append 会抛错并把整个 IIFE 带走（detector 因此从未注册）。
  whenNodeReady(
    () => doc.head,
    (head) => head.appendChild(styleSheet),
    doc,
  );
};

export const injectStyle = (): void => {
  injectCss();
  injectWindow();
};
