import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { data } from '@/api/data';
import { useReading, useReadingChange } from '@/lib/reading';
import { api, inTelegram, requestWriteAccess } from '@/tg/sdk';
import { useBackButton } from '@/tg/hooks';
import { Card, Screen, Section, Skeleton } from '@/ui/ui';
import type { ReadingSettings } from '@shared/reading.mjs';

export function ReadingTracker() {
  useBackButton(false);
  const reading = useReading(), change = useReadingChange();
  const books = useQuery({ queryKey: ['books'], queryFn: data.books, staleTime: Infinity });
  const [prefs, setPrefs] = useState<ReadingSettings>({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, time: '08:00', enabled: false, weekly: false });
  const [notice, setNotice] = useState(''), [book, setBook] = useState('genesis');
  const [quote, setQuote] = useState(''), [source, setSource] = useState(''), [verified, setVerified] = useState(false);
  useEffect(() => { if (reading.data) setPrefs({ ...reading.data.settings, timezone: reading.data.settings.timezone === 'UTC' && !reading.data.settings.enabled ? Intl.DateTimeFormat().resolvedOptions().timeZone : reading.data.settings.timezone }); }, [reading.data?.settings]);
  if (!inTelegram) return <Screen title="4 chapters a day"><Card><p>Open CyberJudah inside Telegram to save your reading and choose a daily reminder.</p></Card></Screen>;
  if (reading.isPending) return <Screen title="4 chapters a day"><Skeleton rows={4} /></Screen>;
  if (reading.isError || !reading.data) return <Screen title="4 chapters a day"><Card><p>Your tracker could not load. Your saved progress is safe.</p><button className="link" onClick={() => void reading.refetch()}>Try again</button></Card></Screen>;
  const r = reading.data, thisWeek = r.calendar.slice(-7), selectedBook = books.data?.find(b => b.slug === book);
  const mark = (slug: string, chapter: number, read: boolean) => change.mutate({ path: 'chapter', value: { slug, chapter, read } });
  const save = async () => {
    setNotice('');
    if ((prefs.enabled || prefs.weekly) && !(r.settings.enabled || r.settings.weekly) && !await requestWriteAccess()) { setNotice('Allow bot messages in Telegram to turn on reminders. Your reading progress is still saved.'); return; }
    try { await change.mutateAsync({ path: 'settings', value: prefs }); setNotice('Reading preferences saved.'); } catch { setNotice('Could not save. Check your connection and try again.'); }
  };
  return <Screen title="4 chapters a day" kicker="Bible tracker">
    <Card glow><p className="card__label">Today · {r.day}</p><p className="verse">{Math.min(r.count, 4)} of 4 chapters</p>
      <div className="progress"><i style={{ width: `${Math.min(100, r.count * 25)}%` }} /></div>
      <p>{r.count >= 4 ? 'Your daily goal is complete. Well done—keep what you read in mind.' : r.finished ? 'You have completed the library. Choose a chapter below to read again.' : 'Make time for four chapters. Your next unread chapters are ready below.'}</p>
      {r.quote ? <blockquote>“{r.quote.text}”<p>{r.quote.source ? <a href={r.quote.source} target="_blank" rel="noopener noreferrer">Bishop Nathanyel · Watch the source</a> : 'Bishop Nathanyel'}</p></blockquote> : <blockquote>“Give attendance to reading”<p>1 Timothy 4:13 · KJV</p></blockquote>}
    </Card>
    <Section title="Today's reading"><div className="reading-chapters">{r.chapters.map(c => <div className="reading-chapter" key={`${c.slug}/${c.chapter}`}>
      <Link to={`/read/${c.slug}/${c.chapter}`}>{c.book} {c.chapter}</Link>
      <button type="button" className="link" disabled={change.isPending} aria-label={`${c.read ? 'Undo' : 'Mark read'} ${c.book} ${c.chapter}`} onClick={() => mark(c.slug, c.chapter, !c.read)}>{c.read ? '✓ Read · Undo' : 'Mark as read'}</button>
    </div>)}</div><p className="hint">Mark chapters you finish here or in your own Bible. Opening a chapter does not complete your reminder goal.</p></Section>
    {change.isError && <p role="alert">That change did not save. Please try again.</p>}
    <div className="stat"><div><b>{r.streak}</b><span>day streak</span></div><div><b>{r.totalRead}</b><span>chapters read</span></div><div><b>{Math.round(r.totalRead / r.total * 100)}%</b><span>of the library</span></div></div>
    <Section title="Your reading calendar"><div className="reading-calendar">{r.calendar.map(d => <div key={d.day} data-done={d.count >= 4 ? '' : undefined} title={`${d.day}: ${d.count} chapters`}><small>{d.day.slice(5)}</small><b>{d.count}</b></div>)}</div><p>Last 7 days: {thisWeek.reduce((n, d) => n + d.count, 0)} chapters across {thisWeek.filter(d => d.count > 0).length} days.</p></Section>
    <Section title="Telegram reminders"><div className="reading-settings">
      <label><input type="checkbox" checked={prefs.enabled} onChange={e => setPrefs({ ...prefs, enabled: e.target.checked })} /> Remind me to read four chapters daily</label>
      <label>Reminder time <input type="time" step="900" value={prefs.time} onChange={e => setPrefs({ ...prefs, time: e.target.value })} /></label>
      <label>Timezone <input aria-label="Timezone" value={prefs.timezone} onChange={e => setPrefs({ ...prefs, timezone: e.target.value })} placeholder="America/New_York" /></label>
      <label><input type="checkbox" checked={prefs.weekly} onChange={e => setPrefs({ ...prefs, weekly: e.target.checked })} /> Monday recap of the previous seven days</label>
      <p className="hint">Reminders use your chosen timezone, including daylight-saving changes. Daily reminders stop once you mark four chapters read. Weekly recaps use the same time. Uncheck both options to pause all reading messages.</p>
      <button className="link" disabled={change.isPending} onClick={() => void save()}>Save reminder settings</button>
      <p role="status">{notice}</p>
    </div></Section>
    <Section title="Book-by-book progress"><label>Choose a book <select value={book} onChange={e => setBook(e.target.value)}>{books.data?.map(b => <option key={b.slug} value={b.slug}>{b.book} · {b.chapterIds.filter(c => r.completed.includes(`${b.slug}/${c}`)).length}/{b.chapterIds.length}</option>)}</select></label>
      <details style={{ marginTop: 16 }}><summary>View chapters or record reading elsewhere</summary><div className="reading-chapters" style={{ marginTop: 12 }}>{selectedBook?.chapterIds.map(ch => { const done = r.completed.includes(`${book}/${ch}`), today = r.chapters.some(c => c.slug === book && c.chapter === ch && c.read); return <div className="reading-chapter" key={ch}><Link to={`/read/${book}/${ch}`}>{selectedBook.book} {ch}{done ? ' ✓' : ''}</Link><button className="link" disabled={change.isPending} onClick={() => mark(book, ch, !today)}>{today ? 'Undo today' : done ? 'Read again today' : 'Mark as read'}</button></div>; })}</div></details>
    </Section>
    {r.admin && <Section title="Reading encouragement"><p>Add an exact quotation from Bishop Nathanyel with its recording link. Only publish wording you have checked against the source.</p><div className="reading-settings"><label>Exact quote<textarea maxLength={500} value={quote} onChange={e => setQuote(e.target.value)} /></label><label>Recording link with timestamp<input type="url" value={source} onChange={e => setSource(e.target.value)} /></label><label><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> I verified the wording and speaker against this source.</label><button className="link" disabled={!verified || !quote.trim() || !source} onClick={async () => { try { await api('/api/reading/quote', { method: 'POST', json: { text: quote, source, verified } }); setQuote(''); setSource(''); setVerified(false); await reading.refetch(); setNotice('Verified quote added to the encouragement rotation.'); } catch { setNotice('Quote could not save. Use a YouTube or CyberJudah recording link.'); } }}>Publish verified quote</button></div></Section>}
    <p className="hint">Your reading history is private to your Telegram account. Existing reading-plan history remains available below.</p>
  </Screen>;
}
