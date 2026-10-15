/**
 * Pictures: an image that fades in once its bytes arrive instead of painting in strips, and a
 * viewer that shows a photo large over the page instead of the browser's own image tab.
 */

import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '../hooks';
import { Icon } from './Icon';

export function FadeImg({ className, onLoad, onError, src, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [arrived, setArrived] = useState<string | null>(null);
  // A picture already in the cache is complete before React listens for its load.
  const seen = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth > 0) setArrived(img.getAttribute('src'));
    },
    [],
  );
  return (
    <img
      ref={seen}
      src={src}
      className={className ? `fade-img ${className}` : 'fade-img'}
      data-loaded={arrived === src ? '' : undefined}
      onLoad={(event) => {
        setArrived(src ?? null);
        onLoad?.(event);
      }}
      onError={(event) => {
        setArrived(src ?? null);
        onError?.(event);
      }}
      {...rest}
    />
  );
}

export interface ViewerPhoto {
  src: string;
  alt: string;
  caption?: string;
}

const CLOSE_MS = 220;

/**
 * Photos one at a time, over the page. Escape, the scrim or the close button closes it; arrow
 * keys, the side buttons or a swipe move between photos. Focus moves in and returns after.
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
  words,
}: {
  photos: readonly ViewerPhoto[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  words: { close: string; previous: string; next: string };
}) {
  const open = index !== null;
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [last, setLast] = useState(index ?? 0);
  const closer = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  if (index !== null && index !== last) setLast(index);

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => {
      setMounted(false);
      opener.current?.focus({ preventScroll: true });
    }, prefersReducedMotion() ? 0 : CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [mounted]);

  useEffect(() => {
    if (shown) closer.current?.focus({ preventScroll: true });
  }, [shown]);

  if (!mounted) return null;
  const photo = photos[last];
  if (!photo) return null;
  const many = photos.length > 1;
  const step = (by: number) => onIndex((last + by + photos.length) % photos.length);

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || !many) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(event.clientY - start.y)) step(dx < 0 ? 1 : -1);
  };

  return createPortal(
    <div
      className={shown ? 'viewer open' : 'viewer'}
      role="dialog"
      aria-modal="true"
      aria-label={photo.alt}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        } else if (many && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
          event.preventDefault();
          step(event.key === 'ArrowRight' ? 1 : -1);
        } else if (event.key === 'Tab') {
          // Focus stays among the viewer's own buttons.
          const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button')];
          const at = buttons.indexOf(document.activeElement as HTMLElement);
          event.preventDefault();
          buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      <div className="viewer-scrim" onClick={onClose} aria-hidden="true" />
      <figure className="viewer-stage" onPointerDown={onDown} onPointerUp={onUp} onClick={(event) => event.target === event.currentTarget && onClose()}>
        <FadeImg key={photo.src} src={photo.src} alt={photo.alt} decoding="async" draggable={false} />
        {photo.caption ? <figcaption>{photo.caption}</figcaption> : null}
      </figure>
      <button ref={closer} type="button" className="viewer-button viewer-close" aria-label={words.close} onClick={onClose}>
        <Icon name="close" size={20} />
      </button>
      {many ? (
        <>
          <button type="button" className="viewer-button viewer-prev" aria-label={words.previous} onClick={() => step(-1)}>
            <Icon name="back" size={20} />
          </button>
          <button type="button" className="viewer-button viewer-next" aria-label={words.next} onClick={() => step(1)}>
            <Icon name="right" size={20} />
          </button>
          <span className="viewer-count" aria-live="polite">
            {last + 1} / {photos.length}
          </span>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
