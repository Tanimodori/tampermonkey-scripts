// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { injectWindowElement } from '../../src/hooks/tooltip';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tooltip 轮换', () => {
  it('初始显示第一个，点击后按 --display-nth 轮换', () => {
    const node = document.createElement('div');
    node.innerHTML = '<div><span class="alternative-container"><span class="alternative">A</span><span class="alternative">B</span></span></div>';
    document.body.appendChild(node);
    injectWindowElement(node);

    const container = node.querySelector('span.alternative-container') as HTMLElement;
    const alts = [...container.querySelectorAll<HTMLElement>('span.alternative')];

    expect(container.style.getPropertyValue('--display-nth')).toBe('0');
    expect(alts[0].style.display).toBe('inline');
    expect(alts[1].style.display).toBe('none');

    alts[1].click();

    expect(container.style.getPropertyValue('--display-nth')).toBe('1');
    expect(alts[0].style.display).toBe('none');
    expect(alts[1].style.display).toBe('inline');

    alts[0].click();

    expect(container.style.getPropertyValue('--display-nth')).toBe('0');
    expect(alts[0].style.display).toBe('inline');
    expect(alts[1].style.display).toBe('none');
  });
});
