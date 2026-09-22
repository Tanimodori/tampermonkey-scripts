import style from '@/style/index.less?inline';

/** Inject Css style to the page */
export const injectCss = () => {
  const styleSheet = document.createElement('style');
  styleSheet.setAttribute('type', 'text/css');
  styleSheet.innerHTML = style;
  document.head.appendChild(styleSheet);
};
