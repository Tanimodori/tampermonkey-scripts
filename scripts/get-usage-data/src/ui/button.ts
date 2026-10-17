import { icons } from './icons';
import injectedStyle from './button.css?inline';

/**
 * 按钮的三种状态，对应三个图标：
 * - `waiting` 页面还没请求过用量接口，转圈；
 * - `ready` 已经采到数据且比上次下载更新，可下载；
 * - `done` 下载之后没有新数据进来，打勾。
 */
export type ButtonState = 'waiting' | 'ready' | 'done';

export interface UsageButton {
  /** 挂进文档的宿主节点，按钮本体在它的 shadow root 里。 */
  readonly element: HTMLElement;
  setState(state: ButtonState): void;
  setVisible(visible: boolean): void;
}

const ICON_OF: Record<ButtonState, string> = {
  waiting: icons.loading,
  ready: icons.download,
  done: icons.check,
};

const LABEL_OF: Record<ButtonState, string> = {
  waiting: '正在等待页面获取用量数据',
  ready: '下载用量数据',
  done: '已下载用量数据',
};

const SIZE = 48;
const MARGIN = 8;
const DEFAULT_INSET = 24;
/** 位移超过这个像素数才算拖动，否则当成点击。 */
const DRAG_THRESHOLD = 4;
const POSITION_KEY = 'get-usage-data:position';

interface Position {
  left: number;
  top: number;
}

const readPosition = (): Position | null => {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Position>;
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
};

const savePosition = (position: Position): void => {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // 隐私模式下 localStorage 会抛；位置记不住不影响用。
  }
};

/** 指针捕获只负责让指针移出按钮后事件还回来：环境没有这个方法、指针已经不在了，都不影响收尾。 */
const capturePointer = (element: HTMLElement, pointerId: number, capture: boolean): void => {
  try {
    if (capture) element.setPointerCapture(pointerId);
    else element.releasePointerCapture(pointerId);
  } catch {
    // 拿不到捕获也无所谓，`pointerup` / `pointercancel` 一样会把拖动收尾。
  }
};

export const createUsageButton = (onDownload: () => void): UsageButton => {
  const host = document.createElement('get-usage-data-button');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${injectedStyle}</style><button class="button" type="button"></button>`;
  const button = shadow.querySelector('.button') as HTMLButtonElement;

  let state: ButtonState = 'waiting';
  let current: Position = { left: 0, top: 0 };
  let start: Position = current;
  let grabOffset: Position = { left: 0, top: 0 };
  let dragging = false;
  let moved = false;
  let suppressClick = false;

  /** 夹在视口里再落位，并记下结果供拖动收尾时存盘。 */
  const place = (position: Position): void => {
    const maxLeft = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
    const maxTop = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
    current = {
      left: Math.min(Math.max(position.left, MARGIN), maxLeft),
      top: Math.min(Math.max(position.top, MARGIN), maxTop),
    };
    host.style.left = `${current.left}px`;
    host.style.top = `${current.top}px`;
  };

  const render = (): void => {
    button.dataset.state = state;
    button.innerHTML = ICON_OF[state];
    button.title = LABEL_OF[state];
    button.setAttribute('aria-label', LABEL_OF[state]);
    // 等数据时不给下载，但按钮仍要能拖：用 aria-disabled 而不是 disabled。
    button.setAttribute('aria-disabled', String(state !== 'ready'));
  };

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    suppressClick = false;
    dragging = true;
    moved = false;
    start = current;
    const rect = host.getBoundingClientRect();
    grabOffset = { left: event.clientX - rect.left, top: event.clientY - rect.top };
    capturePointer(button, event.pointerId, true);
    event.preventDefault(); // 否则拖动会顺带选中页面文字
  });

  button.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const next = { left: event.clientX - grabOffset.left, top: event.clientY - grabOffset.top };
    if (!moved) {
      if (Math.abs(next.left - start.left) < DRAG_THRESHOLD && Math.abs(next.top - start.top) < DRAG_THRESHOLD) return;
      moved = true;
    }
    place(next);
  });

  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    capturePointer(button, event.pointerId, false);
    if (!moved) return;
    savePosition(current);
    suppressClick = true; // 拖完这次抬手不该再触发下载
  };

  button.addEventListener('pointerup', endDrag);
  button.addEventListener('pointercancel', endDrag);

  button.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (state === 'ready') onDownload();
  });

  place(readPosition() ?? { left: window.innerWidth - SIZE - DEFAULT_INSET, top: window.innerHeight - SIZE - DEFAULT_INSET });
  render();

  return {
    element: host,
    setState(next) {
      if (next === state) return;
      state = next;
      render();
    },
    setVisible(visible) {
      host.style.display = visible ? 'block' : 'none';
    },
  };
};
