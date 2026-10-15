/**
 * The site's mark: a bowl seen from above, a red ring, with a pair of chopsticks across it. It
 * borrows the Underground's ring without its bar. public/favicon.svg draws the same.
 */

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle className="ring" cx="19" cy="22" r="12.5" />
      <path className="sticks" d="M33.5 2.5L13.5 37M38 6L19.5 38" />
    </svg>
  );
}

/** Mark and wordmark: the name in the reader's language, and the small line under it. */
export function Logo({ name, sub }: { name: string; sub?: string }) {
  return (
    <>
      <LogoMark />
      <span className="wordmark">
        <b>{name}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
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
