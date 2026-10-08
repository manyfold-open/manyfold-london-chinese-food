/**
 * The site's mark: a bowl and chopsticks on a red tile. public/favicon.svg draws the same.
 */

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect className="tile" width="24" height="24" rx="6" />
      <path className="bowl" d="M4.5 12.5h15a7.5 7.5 0 01-15 0z" />
      <path className="sticks" d="M13.2 3.6l-2.4 7.4M18.6 4.6l-4.8 6.3" />
    </svg>
  );
}

/** Mark and wordmark, the name in the reader's language. */
export function Logo({ name }: { name: string }) {
  return (
    <>
      <LogoMark />
      <span className="wordmark">{name}</span>
    </>
  );
}

/** The Manyfold app's own mark (from manyfold.ai), for "powered by Manyfold". Not this site's logo. */
export function ManyfoldMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="manyfold-mark" width={size * 1.35} height={size} viewBox="0 10 135 75" aria-hidden="true" focusable="false">
      <polygon points="10,80 35,15 47.5,15 22.5,80" className="k" />
      <polygon points="35,15 60,80 47.5,15 72.5,80" className="m" />
      <polygon points="60,80 85,15 72.5,80 97.5,15" className="k" />
      <polygon points="85,15 110,80 97.5,15 122.5,80" className="m" />
    </svg>
  );
}
