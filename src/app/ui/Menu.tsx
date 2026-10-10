/**
 * A button that opens a short list of actions or links. Arrow keys move through the items,
 * Escape and a click outside close it, and focus goes back to the button. The button is a link
 * with a chevron, or, with `iconOnly`, a round icon button named by `label` (a phone's top bar).
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from '../router';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  key: string;
  label: string;
  note?: string;
  href: string;
  /** Saves the file instead of opening it. */
  download?: boolean;
  /** One of the app's own pages: opened in place, as every link to one is. */
  app?: boolean;
  /** The page the reader is on. */
  current?: boolean;
  onSelect?: () => void;
}

export function Menu({
  label,
  icon,
  items,
  end,
  iconOnly,
  className,
}: {
  label: string;
  icon?: IconName;
  items: readonly MenuItem[];
  end?: boolean;
  iconOnly?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const entries = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
    entries[next]?.focus();
  };

  return (
    <div ref={root} className={['menu', end && 'end', className].filter(Boolean).join(' ')} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={iconOnly ? 'icon-button' : 'link-button'}
        aria-label={iconOnly ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        style={iconOnly ? undefined : { display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        {iconOnly ? (
          <Icon name={icon ?? 'menu'} size={18} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={15} /> : null}
            {label}
            <Icon name="down" size={14} />
          </>
        )}
      </button>
      {open ? (
        <div className="menu-list" role="menu" id={id} aria-label={label}>
          {items.map((item) => {
            const props = {
              role: 'menuitem',
              tabIndex: -1,
              className: 'menu-item',
              'aria-current': item.current ? ('page' as const) : undefined,
              onClick: () => {
                item.onSelect?.();
                setOpen(false);
              },
              children: (
                <>
                  {item.label}
                  {item.note ? <small>{item.note}</small> : null}
                </>
              ),
            };
            return item.app ? <Link key={item.key} href={item.href} {...props} /> : <a key={item.key} href={item.href} download={item.download || undefined} {...props} />;
          })}
        </div>
      ) : null}
    </div>
  );
}
