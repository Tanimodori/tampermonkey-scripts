import { downloadJson, fileNameOf } from './download';
import { whenNodeReady } from './hooks/dom';
import { interceptFetch } from './hooks/fetch';
import { watchPath } from './hooks/route';
import { interceptXhr } from './hooks/xhr';
import { clinepass } from './providers/clinepass';
import { deepseek } from './providers/deepseek';
import { providerOn } from './providers/types';
import { capture, capturedCount, revisionOf, snapshot, subscribe } from './store';
import { createUsageButton, type ButtonState } from './ui/button';

/** 支持的服务商。各自声明页面路径与要采集的接口，入口只负责把它们串起来。 */
const providers = [deepseek, clinepass];

const sink = (requestUrl: string, data: unknown): void => capture(requestUrl, data, new Date());

/** 任一服务商的接口命中即采集；同一个页面只会属于一家。 */
const matchesAny = (url: URL): boolean => providers.some((provider) => provider.matchesRequest(url));

// 两层拦截都装在页面自己的请求路径上，越早越好：`document-start` 时页面还没发出第一个请求。
interceptFetch(window, matchesAny, sink);
interceptXhr(XMLHttpRequest, matchesAny, sink);

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
      const provider = providerOn(providers, location.pathname);
      if (!provider) return;
      downloadJson(fileNameOf(provider.id, new Date()), snapshot());
      downloadedRevision = revisionOf();
      button.setState(stateOf());
    });

    subscribe(() => button.setState(stateOf()));

    body.appendChild(button.element);
    // 只在用量页露脸：落地就在别的页、或站内跳转过去，都靠这一条盯。
    button.setVisible(false);
    watchPath((pathname) => button.setVisible(providerOn(providers, pathname) !== undefined));
    button.setState(stateOf()); // 拦截早于按钮建立，先按已有数据补一次状态
  },
);
