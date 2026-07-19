const BUTTON_CLASS = 'tm-feishu-audio-download';
const FILE_PAGE_PATH_RE = /^\/file\/([A-Za-z0-9]+)$/;
const TOOLBAR_SELECTOR = '.note-title__btn-container';
const TOOLBAR_PC_TOOLS_SELECTOR = '.pc-tools';
const BUTTON_WRAP_CLASS = 'tm-feishu-audio-download-wrap';
const BUTTON_ID = 'tm-feishu-audio-download-button';
const BUTTON_TEXT_DEFAULT = '下载音频';

const installDownloadClickInterceptor = () => {
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (type === 'click' && listener) {
      const listenerText =
        typeof listener === 'function'
          ? listener.toString()
          : listener.handleEvent
            ? listener.handleEvent.toString()
            : '';
      if (listenerText.includes('download')) {
        return;
      }
    }
    originalAddEventListener.call(this, type, listener, options);
  };
};

const getPageFileToken = (): string | null => {
  if (!location.hostname.endsWith('.feishu.cn')) {
    return null;
  }

  const matched = location.pathname.match(FILE_PAGE_PATH_RE);
  if (!matched) {
    return null;
  }

  return matched[1] || null;
};

const isTargetAudioElement = (audio: HTMLAudioElement, pageFileToken: string): boolean => {
  if (audio.getAttribute('mediatype') !== 'audio') {
    return false;
  }

  const src = getAudioSource(audio);
  if (!src) {
    return false;
  }

  try {
    const url = new URL(src);
    if (url.hostname !== 'internal-api-drive-stream.feishu.cn') {
      return false;
    }

    const expectedPath = `/space/api/box/stream/download/preview/${pageFileToken}`;
    return url.pathname === expectedPath;
  } catch {
    return false;
  }
};

const injectStyle = () => {
  const style = document.createElement('style');
  style.textContent = `
.${BUTTON_WRAP_CLASS} {
  display: inline-block;
  margin: 0 8px 0 4px;
}

a.${BUTTON_CLASS} {
  text-decoration: none;
}
`;
  document.head.appendChild(style);
};

const getAudioSource = (audio: HTMLAudioElement): string | null => {
  if (audio.src) {
    return audio.src;
  }

  const source = audio.querySelector('source');
  if (source?.src) {
    return source.src;
  }

  return null;
};

const buildFileName = (urlString: string) => {
  try {
    const url = new URL(urlString);
    const raw = decodeURIComponent(url.pathname.split('/').pop() || 'feishu-audio');
    return raw || 'feishu-audio';
  } catch {
    return 'feishu-audio';
  }
};

const bindDownload = (anchor: HTMLAnchorElement, src: string) => {
  anchor.href = src;
  anchor.download = buildFileName(src);
  anchor.removeAttribute('target');
  anchor.rel = 'noreferrer noopener';
};

const getFirstAudioSource = (pageFileToken: string): string | null => {
  const audios = document.querySelectorAll<HTMLAudioElement>('audio[mediatype="audio"]');
  for (const audio of audios) {
    if (!isTargetAudioElement(audio, pageFileToken)) {
      continue;
    }

    const src = getAudioSource(audio);
    if (src) {
      return src;
    }
  }
  return null;
};

const getOrCreateDownloadButton = (): HTMLAnchorElement | null => {
  const existing = document.getElementById(BUTTON_ID);
  if (existing instanceof HTMLAnchorElement) {
    return existing;
  }

  const toolbar = document.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
  if (!toolbar) {
    return null;
  }

  const wrap = document.createElement('div');
  wrap.className = BUTTON_WRAP_CLASS;

  const anchor = document.createElement('a');
  anchor.id = BUTTON_ID;
  anchor.className = `${BUTTON_CLASS} ud__button ud__button--outlined ud__button--outlined-default ud__button--size-md`;
  anchor.textContent = BUTTON_TEXT_DEFAULT;
  wrap.appendChild(anchor);

  const pcTools = toolbar.querySelector(TOOLBAR_PC_TOOLS_SELECTOR);
  if (pcTools?.parentElement === toolbar) {
    const previous = pcTools.previousElementSibling;
    if (previous?.parentElement === toolbar) {
      toolbar.insertBefore(wrap, previous.nextSibling);
    } else {
      toolbar.insertBefore(wrap, pcTools);
    }
  } else {
    toolbar.appendChild(wrap);
  }

  return anchor;
};

const removeDownloadButton = () => {
  const anchor = document.getElementById(BUTTON_ID);
  if (!(anchor instanceof HTMLElement)) {
    return;
  }

  const wrap = anchor.closest(`.${BUTTON_WRAP_CLASS}`);
  if (wrap) {
    wrap.remove();
    return;
  }
  anchor.remove();
};

const syncDownloadButton = (src: string | null) => {
  if (!src) {
    removeDownloadButton();
    return;
  }

  const anchor = getOrCreateDownloadButton();
  if (!anchor) {
    return;
  }

  bindDownload(anchor, src);
};

const injectAll = () => {
  const pageFileToken = getPageFileToken();
  if (!pageFileToken) {
    removeDownloadButton();
    return;
  }

  const src = getFirstAudioSource(pageFileToken);
  syncDownloadButton(src);
};

const observeAudioChanges = () => {
  if (!getPageFileToken()) {
    return;
  }

  const observer = new MutationObserver(() => {
    injectAll();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'mediatype'],
  });
};

const bootstrap = () => {
  installDownloadClickInterceptor();
  injectStyle();
  injectAll();
  observeAudioChanges();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
