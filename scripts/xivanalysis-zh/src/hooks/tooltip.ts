// tooltip 里 span.alternative 的轮换显示。与 CSS 注入分开，便于在 jsdom 中单独验证点击与 --display-nth。
export const incrementAltContainer = (container: HTMLElement, increment: number): void => {
  const alts = container.querySelectorAll('span.alternative');
  const length = alts.length;
  let index = parseInt(container.style.getPropertyValue('--display-nth'));
  if (isNaN(index)) {
    index = increment;
  } else {
    index = (index + increment) % length;
  }
  container.style.setProperty('--display-nth', index.toString());

  for (let i = 0; i < length; i++) {
    const alt = alts[i];
    if (alt instanceof HTMLElement) {
      alt.style.display = i === index ? 'inline' : 'none';
    }
  }
};

export const injectWindowElement = (node: HTMLElement): void => {
  const applyToContainers = (): void => {
    const altContainers = node.querySelectorAll('div span.alternative-container');
    for (const altContainer of altContainers) {
      incrementAltContainer(altContainer as HTMLElement, 0);
    }
  };
  applyToContainers();
  const observer = new MutationObserver(applyToContainers);
  observer.observe(node, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });

  node.addEventListener('click', (event) => {
    let target = event.target;
    while (target instanceof HTMLElement) {
      if (target.tagName.toLowerCase() === 'span' && target.classList.contains('alternative')) {
        const container = target.parentElement as HTMLElement;
        incrementAltContainer(container, 1);
        break;
      }
      target = target.parentElement;
    }
  });
};

export const injectWindow = (win: Window = window, doc: Document = document): void => {
  win.addEventListener('load', () => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length === 0) {
          return;
        }
        const node = mutation.addedNodes[0] as HTMLElement;
        if (
          node.tagName.toLowerCase() === 'div' &&
          node.id.toLowerCase() !== 'root' &&
          node.style.position.toLowerCase() === 'absolute' &&
          node.style.top.toLowerCase() === '0px' &&
          node.style.left.toLowerCase() === '0px'
        ) {
          injectWindowElement(node);
        }
      });
    });
    observer.observe(doc.body, { attributes: true, childList: true, subtree: false });
  });
};
