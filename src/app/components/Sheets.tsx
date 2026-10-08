/** The two things a reader can send: a photo they took, and a report on something wrong. */

import { useEffect, useRef, useState } from 'react';
import { ApiError, getJson, postForm, postJson } from '../api';
import { useCopy, useLocale } from '../i18n';
import { subjectLabel } from '../labels';
import { Button, CheckRow, RadioPills, Sheet, Textarea, TextField, useToast } from '../ui';

const SUBJECTS = ['dish', 'menu', 'storefront', 'interior', 'other'] as const;
type Subject = (typeof SUBJECTS)[number];

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; 'expired-callback': () => void; language?: string }) => string;
      remove: (id: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile'));
    document.head.appendChild(script);
  });
}

/** Cloudflare's check that a person is sending the form; its answer goes with the upload. */
function Turnstile({ onAnswer }: { onAnswer: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    getJson<{ turnstile_site_key: string }>('/api/upload-config')
      .then(async ({ turnstile_site_key }) => {
        if (!turnstile_site_key || cancelled) return;
        await loadTurnstile();
        if (cancelled || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: turnstile_site_key,
          action: 'photo-upload',
          language: locale === 'zh' ? 'zh-cn' : 'en',
          callback: (token) => onAnswer(token),
          'expired-callback': () => onAnswer(null),
        });
      })
      .catch(() => onAnswer(null));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [locale, onAnswer]);
  return <div className="turnstile" ref={box} />;
}

export function UploadSheet({ open, onClose, placeId, dishes }: { open: boolean; onClose: () => void; placeId: string; dishes: string[] }) {
  const copy = useCopy();
  const locale = useLocale();
  const toast = useToast();
  const [subject, setSubject] = useState<Subject>('dish');
  const [dish, setDish] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = Boolean(file && agreed && answer && (subject !== 'dish' || dish.trim()));

  const send = async () => {
    if (!file || !answer) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    form.set('subject', subject);
    if (subject === 'dish') form.set('dish_name', dish.trim());
    if (caption.trim()) form.set('caption', caption.trim());
    if (credit.trim()) form.set('attribution', credit.trim());
    form.set('license', 'CC-BY-4.0');
    form.set('cf-turnstile-response', answer);
    try {
      await postForm(`/api/places/${placeId}/photos`, form);
      toast(copy.upload.sent);
      setFile(null);
      setCaption('');
      setDish('');
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : copy.upload.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} title={copy.upload.title} onClose={onClose}>
      <div className="form">
        <p className="form-note">{copy.upload.rules}</p>
        <label className="field">
          <span>{copy.upload.file}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <div className="field">
          <span>{copy.upload.subject}</span>
          <RadioPills label={copy.upload.subject} choices={SUBJECTS.map((value) => ({ value, label: subjectLabel(value, locale) }))} value={subject} onChange={setSubject} />
        </div>
        {subject === 'dish' ? (
          <label className="field">
            <span>{copy.upload.dishName}</span>
            <TextField value={dish} maxLength={60} list="upload-dishes" onChange={(event) => setDish(event.target.value)} />
            <datalist id="upload-dishes">
              {dishes.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
        ) : null}
        <label className="field">
          <span>{copy.upload.caption}</span>
          <TextField value={caption} maxLength={200} onChange={(event) => setCaption(event.target.value)} />
        </label>
        <label className="field">
          <span>{copy.upload.attribution}</span>
          <TextField value={credit} maxLength={60} onChange={(event) => setCredit(event.target.value)} />
        </label>
        <CheckRow checked={agreed} label={copy.upload.license} onToggle={() => setAgreed(!agreed)} />
        {open ? <Turnstile onAnswer={setAnswer} /> : null}
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" disabled={!ready || busy} onClick={send}>
          {busy ? copy.upload.sending : copy.upload.send}
        </Button>
      </div>
    </Sheet>
  );
}

export function ReportSheet({ open, onClose, recordId }: { open: boolean; onClose: () => void; recordId: string | null }) {
  const copy = useCopy();
  const toast = useToast();
  const [type, setType] = useState<'wrong' | 'takedown'>('wrong');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!recordId) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/records/${recordId}/report`, { type, reason: reason.trim() });
      toast(copy.report.sent);
      setReason('');
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : copy.upload.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} title={copy.report.title} onClose={onClose}>
      <div className="form">
        <RadioPills
          label={copy.report.title}
          choices={[
            { value: 'wrong' as const, label: copy.report.wrong },
            { value: 'takedown' as const, label: copy.report.takedown },
          ]}
          value={type}
          onChange={setType}
        />
        <label className="field">
          <span>{copy.report.reason}</span>
          <Textarea rows={4} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <Button variant="primary" disabled={reason.trim().length < 3 || busy} onClick={send}>
          {copy.report.send}
        </Button>
      </div>
    </Sheet>
  );
}
