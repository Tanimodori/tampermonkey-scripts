// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { whenNodeReady } from '../../src/hooks/dom';

describe('whenNodeReady', () => {
  it('节点已存在时同步执行', () => {
    const node = document.createElement('div');
    node.id = 'ready';
    document.body.appendChild(node);
    const run = vi.fn();

    whenNodeReady(() => document.getElementById('ready'), run, document);

    expect(run).toHaveBeenCalledWith(node);
  });

  it('节点晚到时在出现后执行一次', async () => {
    const doc = document.implementation.createHTMLDocument('late');
    const run = vi.fn();

    whenNodeReady(() => doc.getElementById('late'), run, doc);
    const node = doc.createElement('div');
    node.id = 'late';
    doc.body.appendChild(node);

    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(node));
    expect(run).toHaveBeenCalledOnce();
  });
});
