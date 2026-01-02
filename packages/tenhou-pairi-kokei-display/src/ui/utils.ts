export interface DocumentLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createElement(tag: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createTextNode(text: string): any;
}

export type ElementType<D = Document> = D extends { createElement(tag: string): infer E } ? E : never;
export type TextType<D = Document> = D extends { createTextNode(text: string): infer N } ? N : never;
export type ElementSpec<D = Document> = string | ElementType<D> | Record<string, unknown>;
export type ElementResult<D = Document> = ElementType<D> | TextType<D>;

/**
 * Construct element for testing
 * @param spec the spec of element
 */
export function getElement(spec: ElementSpec): ElementResult;
/**
 * Construct element for testing
 * @param document the document object
 * @param spec the spec of element
 */
export function getElement<D extends DocumentLike>(document: D, spec: ElementSpec<D>): ElementResult<D>;
export function getElement(arg1: unknown, arg2?: unknown) {
  let targetDocument: DocumentLike;
  let spec: ElementSpec;
  if (arg2) {
    targetDocument = arg1 as DocumentLike;
    spec = arg2 as ElementSpec;
  } else {
    targetDocument = document;
    spec = arg1 as ElementSpec;
  }
  return getElementInner(targetDocument, spec);
}

function getElementInner(document: DocumentLike, spec: ElementSpec): ElementResult {
  if (typeof spec === 'string') {
    return document.createTextNode(spec);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isHTMLElement = (x: any): x is ElementType => {
    return 'tagName' in x;
  };
  if (isHTMLElement(spec)) {
    return spec;
  }
  const element = document.createElement(spec['_tag'] as string);
  for (const key in spec) {
    if (key === '_tag') {
      continue;
    } else if (key === '_class') {
      element.className = spec[key] as string;
    } else if (key === '_innerHTML') {
      element.innerHTML = spec[key] as string;
    } else if (key === '_children') {
      const value = spec[key] as typeof spec[];
      const children = value.map((x) => getElementInner(document, x));
      element.append(...children);
    } else {
      element.setAttribute(key, spec[key] as string);
    }
  }
  return element;
}
