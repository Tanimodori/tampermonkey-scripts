import { fetchAction } from './action';
import { fetchItem } from './item';
import { fetchSearch } from './search';
import { fetchStatus } from './status';
import { translateTimeline } from './timeline';

export const iconCache = new Map<number, string>();

export const fetchIcon = async (url: string, name: string) => {
  // extract ui/icon/######/###### from url
  const iconId = parseInt(url.match(/ui\/icon\/\d+\/(\d+)/)![1]);
  if (isNaN(iconId)) {
    return;
  }

  if (iconCache.has(iconId)) {
    return iconCache.get(iconId) as string;
  }

  const searchItems = await fetchSearch(name);

  for (const searchItem of searchItems) {
    // icon exact match(obj.c 是 unknown,图标号取数字)
    if (Number(searchItem.obj.c) !== iconId) {
      continue;
    }

    if (searchItem.type === 'action') {
      const action = await fetchAction(searchItem.obj.i);
      iconCache.set(iconId, action.name);
      return action.name;
    } else if (searchItem.type === 'status') {
      const status = await fetchStatus(searchItem.obj.i);
      iconCache.set(iconId, status.name);
      return status.name;
    } else {
      // item
      const item = await fetchItem(searchItem.obj.i);
      iconCache.set(iconId, item.name);
      return item.name;
    }
  }

  // fallback to search name
  return translateTimeline(name);
};

export const translateIcon = async (element: HTMLImageElement): Promise<void> => {
  const name = element.alt;
  const translated = await fetchIcon(element.src, name);
  if (translated) {
    if (typeof translated === 'function') {
      translated(element);
    } else {
      element.alt = translated;
      element.title = translated;
    }
  }
};

export const injectIcon = () => {
  const className = 'Timeline-module_item';
  const selector = `[class^="${className}"] img, [class*=" ${className}"] img`;
  const observer = new MutationObserver((mutations) => {
    const found = [];
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.matches(selector)) {
              found.push(node);
            } else {
              const children = node.querySelectorAll(selector);
              for (const child of children) {
                found.push(child);
              }
            }
          }
        }
      }
    }
    for (const node of found) {
      if (node instanceof HTMLImageElement) {
        translateIcon(node);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
};
