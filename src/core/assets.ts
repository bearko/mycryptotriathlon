const cache = new Map<string, HTMLImageElement>();
const whites = new Map<string, HTMLCanvasElement>();

/** Returns the image right away; it draws nothing until it has loaded. */
export function img(url: string): HTMLImageElement {
  let im = cache.get(url);
  if (!im) {
    im = new Image();
    im.decoding = 'async';
    im.src = url;
    cache.set(url, im);
  }
  return im;
}
export const ready = (im: HTMLImageElement) => im.complete && im.naturalWidth > 0;

export function preload(urls: string[]): Promise<void> {
  return Promise.all(
    urls.map((u) => {
      const im = img(u);
      if (ready(im)) return Promise.resolve();
      return new Promise<void>((res) => {
        im.addEventListener('load', () => res(), { once: true });
        im.addEventListener('error', () => res(), { once: true });
      });
    }),
  ).then(() => undefined);
}

/** A white silhouette of the image, for the hit flash. */
export function whiteOf(url: string): HTMLCanvasElement | null {
  const hit = whites.get(url);
  if (hit) return hit;
  const im = img(url);
  if (!ready(im)) return null;
  const c = document.createElement('canvas');
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(im, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  whites.set(url, c);
  return c;
}

const greys = new Map<string, HTMLCanvasElement>();
/** A greyed-out copy of the image, for a runner who is out cold. */
export function greyOf(url: string): HTMLCanvasElement | null {
  const hit = greys.get(url);
  if (hit) return hit;
  const im = img(url);
  if (!ready(im)) return null;
  const c = document.createElement('canvas');
  c.width = im.naturalWidth;
  c.height = im.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(im, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(96,98,112,0.82)';
  g.fillRect(0, 0, c.width, c.height);
  greys.set(url, c);
  return c;
}
