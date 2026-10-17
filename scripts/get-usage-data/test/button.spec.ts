import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUsageButton, type ButtonState } from '@/ui/button';

const POSITION_KEY = 'get-usage-data:position';

const rect = (left: number, top: number): DOMRect =>
  ({
    x: left,
    y: top,
    left,
    top,
    right: left + 48,
    bottom: top + 48,
    width: 48,
    height: 48,
    toJSON: () => ({}),
  }) as DOMRect;

const pointer = (type: string, clientX: number, clientY: number): PointerEvent => new PointerEvent(type, { clientX, clientY, button: 0, bubbles: true });

const mount = (): { button: ReturnType<typeof createUsageButton>; inner: HTMLButtonElement; onDownload: () => void } => {
  const onDownload = vi.fn();
  const button = createUsageButton(onDownload);
  document.body.appendChild(button.element);
  const inner = button.element.shadowRoot?.querySelector('.button') as HTMLButtonElement;
  return { button, inner, onDownload };
};

describe('createUsageButton', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('三种状态各换一个图标，且都是内联的 SVG', () => {
    const { button, inner } = mount();
    const rendered = new Set<string>();

    for (const state of ['waiting', 'ready', 'done'] as const satisfies ButtonState[]) {
      button.setState(state);
      rendered.add(inner.innerHTML);
      expect(inner.dataset.state).toBe(state);
      expect(inner.querySelector('svg')).not.toBeNull();
    }

    expect(rendered.size).toBe(3);
  });

  it('只有 ready 状态的点击才下载', () => {
    const { button, inner, onDownload } = mount();

    inner.click();
    expect(onDownload).not.toHaveBeenCalled();

    button.setState('ready');
    inner.click();
    expect(onDownload).toHaveBeenCalledTimes(1);

    button.setState('done');
    inner.click();
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('等数据时用 aria-disabled 表达不可下载，但按钮仍可拖动', () => {
    const { inner } = mount();

    expect(inner.getAttribute('aria-disabled')).toBe('true');
    expect(inner.disabled).toBe(false);
  });

  it('按 visible 显隐', () => {
    const { button } = mount();

    button.setVisible(false);
    expect(button.element.style.display).toBe('none');

    button.setVisible(true);
    expect(button.element.style.display).toBe('block');
  });

  it('拖动超过阈值后落位并存下位置，随后的 click 不再下载', () => {
    // 内部位置与视觉位置在真实页面里是一回事，用例里让 mock 的矩形与存下的位置对齐。
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left: 952, top: 696 }));
    const { button, inner, onDownload } = mount();
    button.setState('ready');
    vi.spyOn(button.element, 'getBoundingClientRect').mockReturnValue(rect(952, 696));

    // 抓在按钮中心偏右下（48, 48），拖到视口左上角附近。
    inner.dispatchEvent(pointer('pointerdown', 1000, 744));
    inner.dispatchEvent(pointer('pointermove', 148, 148));
    inner.dispatchEvent(pointer('pointerup', 148, 148));

    expect(button.element.style.left).toBe('100px');
    expect(button.element.style.top).toBe('100px');
    expect(JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null')).toEqual({ left: 100, top: 100 });

    inner.click(); // 浏览器在拖动之后仍会补一次 click
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('位移不到阈值就还是一次点击', () => {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left: 100, top: 100 }));
    const { button, inner, onDownload } = mount();
    button.setState('ready');
    vi.spyOn(button.element, 'getBoundingClientRect').mockReturnValue(rect(100, 100));

    inner.dispatchEvent(pointer('pointerdown', 120, 120));
    inner.dispatchEvent(pointer('pointermove', 122, 120));
    inner.dispatchEvent(pointer('pointerup', 122, 120));
    inner.click();

    expect(onDownload).toHaveBeenCalledTimes(1);
    // 没被当成拖动，位置就不该改写。
    expect(JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null')).toEqual({ left: 100, top: 100 });
  });

  it('记住上次拖到的位置', () => {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left: 300, top: 200 }));

    const { button } = mount();

    expect(button.element.style.left).toBe('300px');
    expect(button.element.style.top).toBe('200px');
  });
});
