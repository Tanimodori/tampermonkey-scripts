const BUTTON_CLASS = 'tm-feishu-download';
const FILE_PAGE_PATH_RE = /^\/file\/([A-Za-z0-9]+)$/;
const TOOLBAR_SELECTOR = '.note-title__btn-container';
const TOOLBAR_PC_TOOLS_SELECTOR = '.pc-tools';
const BUTTON_WRAP_CLASS = 'tm-feishu-download-wrap';
const AUDIO_BUTTON_ID = 'tm-feishu-audio-download-button';
const IMAGE_BUTTON_ID = 'tm-feishu-image-download-button';
const AUDIO_BUTTON_TEXT = '下载音频';
const IMAGE_BUTTON_TEXT = '下载图片';
const SOURCE_ATTR = 'data-download-src';
const FILENAME_ATTR = 'data-download-filename';

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

const isTargetImageElement = (img: HTMLImageElement): boolean => {
  if (img.getAttribute('data-select') !== 'box-preview-image-viewer') {
    return false;
  }

  const fileToken = img.getAttribute('data-file-token');
  if (!fileToken) {
    return false;
  }

  const src = img.src;
  if (!src) {
    return false;
  }

  try {
    const url = new URL(src);
    if (url.hostname !== 'internal-api-drive-stream.feishu.cn') {
      return false;
    }

    const expectedPath = `/space/api/box/stream/download/preview/${fileToken}`;
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

const getMetaTitleFileName = (): string | null => {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="title"]');
  if (!meta) {
    return null;
  }

  const title = meta.content.trim();
  return title || null;
};

const buildFileName = (urlString: string) => {
  const fromMeta = getMetaTitleFileName();
  if (fromMeta) {
    return fromMeta;
  }

  try {
    const url = new URL(urlString);
    const raw = decodeURIComponent(url.pathname.split('/').pop() || 'feishu-download');
    return raw || 'feishu-download';
  } catch {
    return 'feishu-download';
  }
};

const bindDownload = (anchor: HTMLAnchorElement, src: string) => {
  const filename = buildFileName(src);
  anchor.href = '#';
  anchor.download = filename;
  anchor.setAttribute(SOURCE_ATTR, src);
  anchor.setAttribute(FILENAME_ATTR, filename);
  anchor.removeAttribute('target');
  anchor.rel = 'noreferrer noopener';
};

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const blobUrl = URL.createObjectURL(blob);
  const temp = document.createElement('a');
  temp.href = blobUrl;
  temp.download = filename;
  temp.style.display = 'none';
  document.body.appendChild(temp);
  temp.click();
  temp.remove();
  URL.revokeObjectURL(blobUrl);
};

const downloadByBlob = async (anchor: HTMLAnchorElement) => {
  const src = anchor.getAttribute(SOURCE_ATTR);
  const filename = anchor.getAttribute(FILENAME_ATTR) || 'feishu-download';
  if (!src) {
    return;
  }

  const response = await fetch(src, {
    credentials: 'include',
    mode: 'cors',
  });
  if (!response.ok) {
    throw new Error(`Download request failed: ${response.status}`);
  }

  const blob = await response.blob();
  triggerBlobDownload(blob, filename);
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

const getFirstImageSource = (): string | null => {
  const images = document.querySelectorAll<HTMLImageElement>(
    'img[data-select="box-preview-image-viewer"][data-file-token]',
  );
  for (const img of images) {
    if (!isTargetImageElement(img)) {
      continue;
    }
    if (img.src) {
      return img.src;
    }
  }
  return null;
};

const getOrCreateDownloadButton = (buttonId: string, text: string): HTMLAnchorElement | null => {
  const existing = document.getElementById(buttonId);
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
  anchor.id = buttonId;
  anchor.className = `${BUTTON_CLASS} ud__button ud__button--outlined ud__button--outlined-default ud__button--size-md`;
  anchor.textContent = text;
  anchor.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void downloadByBlob(anchor).catch((error) => {
      console.error('Failed to download file via blob:', error);
    });
  });
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

const removeDownloadButton = (buttonId: string) => {
  const anchor = document.getElementById(buttonId);
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

const syncDownloadButton = (buttonId: string, text: string, src: string | null) => {
  if (!src) {
    removeDownloadButton(buttonId);
    return;
  }

  const anchor = getOrCreateDownloadButton(buttonId, text);
  if (!anchor) {
    return;
  }

  bindDownload(anchor, src);
};

const injectAll = () => {
  const pageFileToken = getPageFileToken();
  if (!pageFileToken) {
    removeDownloadButton(AUDIO_BUTTON_ID);
    removeDownloadButton(IMAGE_BUTTON_ID);
    return;
  }

  const audioSrc = getFirstAudioSource(pageFileToken);
  const imageSrc = getFirstImageSource();
  syncDownloadButton(AUDIO_BUTTON_ID, AUDIO_BUTTON_TEXT, audioSrc);
  syncDownloadButton(IMAGE_BUTTON_ID, IMAGE_BUTTON_TEXT, imageSrc);
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
