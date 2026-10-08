import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";
import { data, type Chapter } from "@/api/data";
import { Button } from "@/ui/ui";
import { ambient } from "./ambient";
import { AudioIntent } from "./audio-intent.mjs";
import { adjacentChapter, bindMediaSession, type AudioChapter } from "./audio-continuity.mjs";
import { useSpeech } from "./tts";
import "./audio-player.css";

type Selection = { where: AudioChapter; verses: Chapter["verses"]; label: string; command?: { generation: number; from: number } };
const same = (a: AudioChapter | undefined | null, b: AudioChapter | undefined | null) => a?.slug === b?.slug && a?.chapter === b?.chapter;
function usePlayer() {
  const client = useQueryClient();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState(false), [loadPaused, setLoadPaused] = useState(false);
  const [notice, setNotice] = useState("");
  const [repeat, setRepeat] = useState(false);
  // The audio controls follow the one shared player across reader mounts and tabs.
  const [expanded, setExpanded] = useState(false);
  const intent = useRef(new AudioIntent());
  const active = useRef(false), loading = useRef(false);
  const target = useRef<AudioChapter | null>(null);
  const speech = useSpeech(selection?.verses ?? [], selection?.label ?? "", selection?.where);
  const engine = useRef(speech); engine.current = speech;
  const stop = () => {
    intent.current.stop(); active.current = false; loading.current = false;
    setPending(false); setLoadPaused(false); setNotice(""); engine.current.stop();
  };
  const prepare = (value: Selection) => {
    // A failed media start reports its notice before the player's own effect clears `active`
    // (children run first), so retarget on that failure signal too, not only when active is false.
    if ((!active.current || (!speech.playing && !!speech.notice)) && !same(selection?.where, value.where)) {
      target.current = value.where; setSelection(value);
    }
  };
  const start = (where: AudioChapter, from = 1, fromGesture = true) => {
    const generation = intent.current.start();
    active.current = true; loading.current = true; target.current = where;
    engine.current.stop(true); ambient.begin(fromGesture);
    setPending(true); setLoadPaused(false); setNotice("");
    // Keep a loaded passage start inside the tap for device voices that require a gesture.
    if (selection?.verses.length && same(selection.where, where)) {
      loading.current = false; setPending(false); engine.current.play(from, undefined, false); return;
    }
    void client.fetchQuery({ queryKey: ["chapter", where.slug, where.chapter], queryFn: () => data.chapter(where.slug, where.chapter), staleTime: Infinity }).then((chapter) => {
      if (!intent.current.owns(generation)) return;
      if (!chapter.verses.length) throw new Error("Empty chapter");
      setSelection({ where, verses: chapter.verses, label: `${chapter.book} ${where.chapter}`, command: { generation, from } });
    }).catch(() => {
      if (!intent.current.owns(generation)) return;
      stop(); setNotice("The next passage could not load. Return to the passage and try Play again.");
    });
  };
  useEffect(() => {
    const command = selection?.command;
    if (!command || !intent.current.canPlay(command.generation)) return;
    loading.current = false; setPending(false);
    engine.current.play(command.from, undefined, false);
  }, [selection]);
  const toggle = () => {
    if (loading.current) {
      intent.current.paused = !intent.current.paused; setLoadPaused(intent.current.paused);
      if (intent.current.paused) ambient.stop();
      else {
        ambient.begin();
        if (selection?.command && intent.current.owns(selection.command.generation)) setSelection({ ...selection });
      }
    } else if (speech.playing) engine.current.toggle();
    else if (target.current) start(target.current);
  };
  const skip = (direction: number) => {
    const next = adjacentChapter(books.data ?? [], target.current, direction);
    if (next) start(next);
  };
  useEffect(() => {
    if (!speech.completed || !active.current || loading.current) return;
    if (repeat && target.current) { start(target.current, 1, false); return; }
    if (!books.data) {
      if (books.isError) { stop(); setNotice("Chapter order is unavailable. Return to the passage to retry."); }
      return;
    }
    const next = adjacentChapter(books.data, target.current, 1);
    if (next) start(next, 1, false);
    else { stop(); setNotice("End of the Bible."); }
  }, [speech.completed, books.data, books.isError]); // completion reads the current repeat preference
  useEffect(() => {
    // A rejected media start (e.g. NotAllowedError) stops the engine but never calls the player's own
    // stop(); without this, active stays true and a different chapter's reader can never re-target us.
    if (!active.current || speech.playing || !speech.notice) return;
    active.current = false; loading.current = false;
  }, [speech.playing, speech.notice]);
  const controls = useRef({ toggle, stop, skip, start, speech, pending, loadPaused });
  controls.current = { toggle, stop, skip, start, speech, pending, loadPaused };
  useEffect(() => bindMediaSession(navigator.mediaSession, {
    play: () => { const c = controls.current; if (c.pending ? c.loadPaused : !c.speech.playing || c.speech.paused) c.toggle(); },
    pause: () => { const c = controls.current; if (c.pending ? !c.loadPaused : c.speech.playing && !c.speech.paused) c.toggle(); },
    stop: () => controls.current.stop(),
    nexttrack: () => controls.current.skip(1),
    previoustrack: () => controls.current.skip(-1),
  }), []);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.playbackState = speech.audible ? "playing" : speech.playing || pending ? "paused" : "none";
    if (selection && (speech.playing || pending) && typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({ title: selection.label, artist: "King James Bible with the Apocrypha" });
    } else navigator.mediaSession.metadata = null;
  }, [selection, speech.audible, speech.playing, pending]);
  useEffect(() => () => { intent.current.stop(); active.current = false; }, []);
  return { speech: { ...speech, playing: pending || speech.playing, paused: pending ? loadPaused : speech.paused,
    loading: pending || speech.loading, notice: notice || speech.notice, stop, toggle,
    play: (from = 1) => { if (selection && !loading.current) { active.current = true; setNotice(""); engine.current.play(from); } } },
    selection, pending, prepare, start, skip, repeat, setRepeat, expanded, setExpanded,
    previous: adjacentChapter(books.data ?? [], target.current, -1), next: adjacentChapter(books.data ?? [], target.current, 1) };
}
type Player = ReturnType<typeof usePlayer>;
const PlayerContext = createContext<Player | null>(null);
export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const player = usePlayer();
  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>;
}
export function useAudioPlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("Audio player provider is missing");
  return value;
}
export function useReaderSpeech(verses: Chapter["verses"], label: string, where: AudioChapter) {
  const player = useAudioPlayer();
  useEffect(() => { if (verses.length) player.prepare({ where, verses, label }); }, [where.slug, where.chapter, verses.length, player.speech.playing]);
  const here = same(player.selection?.where, where);
  return { ...player.speech, supported: verses.length > 0, current: here ? player.speech.current : null,
    play: (from = 1) => { if (here && player.speech.playing && !player.pending) player.speech.play(from); else player.start(where, from); },
    toggle: () => { if (here) player.speech.toggle(); else player.start(where); } };
}
/** An opaque control surface shares the dock clearance without adding another backdrop filter. */
export function AudioPlayerBar() {
  const player = useAudioPlayer(), location = useLocation(), navigate = useNavigate();
  const { selection, speech } = player;
  const bar = useRef<HTMLElement>(null);
  const reader = /^\/(read|bible)(\/|$)/.test(location.pathname);
  const visible = !!selection && (!reader || new URLSearchParams(location.search).has("v")) && (speech.playing || !!speech.notice);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-audio-bar", visible);
    const measure = () => document.documentElement.style.setProperty("--audio-bar-space", `${Math.ceil(bar.current?.getBoundingClientRect().height ?? 0) + 16}px`);
    const observer = new ResizeObserver(measure);
    if (visible && bar.current) { observer.observe(bar.current); measure(); }
    return () => { observer.disconnect(); document.documentElement.removeAttribute("data-audio-bar"); document.documentElement.style.removeProperty("--audio-bar-space"); };
  }, [visible]);
  if (!visible || !selection) return null;
  return <section ref={bar} className="audio-player" aria-label="Bible audio player">
    <Button size="sm" onClick={() => navigate(`/read/${selection.where.slug}/${selection.where.chapter}`)} aria-label="Return to current passage">{selection.label}</Button>
    <div className="audio-player__controls">
      <Button size="sm" onClick={speech.toggle} aria-label={speech.paused ? "Resume audio playback" : speech.playing ? "Pause audio playback" : "Start audio playback"}>{speech.paused ? "Resume" : speech.playing ? "Pause" : "Play"}</Button>
      <Button size="sm" onClick={speech.stop} aria-label="Stop audio playback">Stop</Button>
      <Button size="sm" disabled={!player.next} onClick={() => player.skip(1)} aria-label="Next audio chapter">Next</Button>
    </div>
    {speech.loading || speech.notice ? <p role="status">{speech.notice || "Loading audio…"}</p> : null}
  </section>;
}
