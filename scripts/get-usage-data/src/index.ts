import { downloadJson, fileNameOf } from './download';
import { whenNodeReady } from './hooks/dom';
import { interceptFetch } from './hooks/fetch';
import { watchPath } from './hooks/route';
import { interceptXhr } from './hooks/xhr';
import { deepseek } from './providers/deepseek';
import { isOnPage } from './providers/types';
import { capture, capturedCount, revisionOf, snapshot, subscribe } from './store';
import { createUsageButton, type ButtonState } from './ui/button';

// 目前只支持 DeepSeek 一家；接更多服务商时在这里换一家，或改成一串逐个比对。
const provider = deepseek;

const sink = (requestUrl: string, data: unknown): void => capture(requestUrl, data, new Date());

// 两层拦截都装在页面自己的请求路径上，越早越好：`document-start` 时页面还没发出第一个请求。
interceptFetch(window, provider.matchesRequest, sink);
interceptXhr(XMLHttpRequest, provider.matchesRequest, sink);

whenNodeReady(
  () => document.body,
  (body) => {
    /** 上次下载时的采集版本号；-1 表示还没下载过。 */
    let downloadedRevision = -1;

    const stateOf = (): ButtonState => {
      if (capturedCount() === 0) return 'waiting';
      return revisionOf() === downloadedRevision ? 'done' : 'ready';
    };

    const button = createUsageButton(() => {
      downloadJson(fileNameOf(provider.id, new Date()), snapshot());
      downloadedRevision = revisionOf();
      button.setState(stateOf());
    });

    subscribe(() => button.setState(stateOf()));

    body.appendChild(button.element);
    // 只在用量页露脸：落地就在别的页、或站内跳转过去，都靠这一条盯。
    button.setVisible(false);
    watchPath((pathname) => button.setVisible(isOnPage(provider, pathname)));
    button.setState(stateOf()); // 拦截早于按钮建立，先按已有数据补一次状态
  },
);
