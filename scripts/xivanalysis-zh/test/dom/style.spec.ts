// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { injectCss } from '../../src/style';

describe('样式注入', () => {
  it('head 已存在时立即写入', () => {
    const doc = document.implementation.createHTMLDocument('ready');
    injectCss(doc);

    const style = doc.head.querySelector('style');
    expect(style?.textContent).toContain('span.highlight-yellow');
  });

  it('head 晚到时在出现后写入', async () => {
    const doc = document.implementation.createHTMLDocument('late');
    doc.documentElement.removeChild(doc.head);
    injectCss(doc);

    const head = doc.createElement('head');
    doc.documentElement.appendChild(head);

    await vi.waitFor(() => expect(doc.head.querySelector('style')?.textContent).toContain('span.highlight-yellow'));
  });
});
