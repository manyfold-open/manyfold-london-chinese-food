import { useState } from 'react';
import { TextField, useToast } from '../ui';
import { send, useAdmin } from './adminApi';
import { Action, Field, Loading, Notice, plural } from './ui';

/** The form src/worker/console.ts (setBlockedHosts) accepts: a host name with a dot, nothing else. */
const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

/** A host from what was typed or pasted: "example.com", "www.example.com", or a whole URL. */
function hostFrom(text: string): string | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  let host = value;
  if (/[/:]/.test(value)) {
    try {
      host = new URL(value.includes('://') ? value : `https://${value}`).hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, '');
  return HOST.test(host) ? host : null;
}

/** Sites whose owners asked not to be quoted: records citing them are refused at submit. */
export default function BlockedHostsSection() {
  const toast = useToast();
  const { data, error, loading, reload } = useAdmin<{ hosts: string[] }>('/blocked-hosts');
  const [text, setText] = useState('');
  const hosts = data?.hosts ?? [];
  const save = (next: string[]) => send<{ hosts: string[] }>('PUT', '/blocked-hosts', { hosts: next });
  const typed = hostFrom(text);

  return (
    <>
      <div className="section-head">
        <h2>Blocked hosts</h2>
        <span className="muted">{data ? plural(hosts.length, 'host') : ''}</span>
      </div>
      <p className="muted small">
        Sites whose owners asked not to be quoted. A record whose source is on one of them, or on any of its subdomains, is refused when it is sent. A
        takedown can add its record's site here. Records already on the site stay until you take them down.
      </p>
      <Notice error={error} />
      <form className="inline-form" onSubmit={(event) => event.preventDefault()}>
        <Field label="Host or URL">
          <TextField value={text} onChange={(event) => setText(event.target.value)} placeholder="example.com" spellCheck={false} autoCapitalize="none" />
        </Field>
        <Action
          label="Block"
          check={() => (!typed ? 'Enter a host name such as example.com.' : hosts.includes(typed) ? `${typed} is blocked already.` : null)}
          run={() => save([...hosts, typed!])}
          onDone={() => {
            toast(`Blocked ${typed}`);
            setText('');
            reload();
          }}
        />
      </form>
      {!data && loading ? <Loading rows={3} height={40} /> : null}
      {data && hosts.length === 0 ? <p className="muted">No host is blocked.</p> : null}
      {hosts.length > 0 ? (
        <ul className="host-list">
          {hosts.map((host) => (
            <li key={host}>
              <code>{host}</code>
              <Action
                label="Unblock"
                confirm={`Unblock ${host}? Records quoting it will be accepted again.`}
                run={() => save(hosts.filter((entry) => entry !== host))}
                onDone={() => {
                  toast(`Unblocked ${host}`);
                  reload();
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
