import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { data, type Book } from "@/api/data";
import { usePlan } from "@/lib/marks";
import { startPlan } from "@/lib/plan";
import { useBackButton } from "@/tg/hooks";
import { confirm } from "@/tg/sdk";
import { Screen, Icon } from "@/ui/ui";
import { Button } from "@/ui/Button";
import { StudyNotice } from "@/studies/controls";
import "@/studies/studies.css";

const plans: { name: string; description: string; select: (b: Book) => boolean }[] = [
  { name: "Whole Bible with Apocrypha", description: "Read every book in the library’s order.", select: () => true },
  { name: "New Testament", description: "Matthew through Revelation, in book order.", select: b => b.testament === "New Testament" },
  { name: "Apocrypha", description: "The books included in the King James Apocrypha.", select: b => b.testament === "Apocrypha" },
  { name: "Psalms and Proverbs", description: "Read through these two books, a chapter at a time.", select: b => ["psalms", "proverbs"].includes(b.slug) },
  { name: "The Law", description: "Genesis, Exodus, Leviticus, Numbers and Deuteronomy.", select: b => ["genesis", "exodus", "leviticus", "numbers", "deuteronomy"].includes(b.slug) },
];
export function ReadingPlans() {
  useBackButton(true);
  const navigate = useNavigate(), [plan, setPlan] = usePlan(), [pace, setPace] = useState(1), [selectedBook, setSelectedBook] = useState("");
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const start = async (name: string, selected: Book[]) => {
    if (!selected.length || (plan && !await confirm(`Switch to ${name}? Your completed chapters stay marked; this plan starts on day one.`))) return;
    setPlan({ ...startPlan(pace), name, books: selected.map(b => b.slug) }); navigate("/plan");
  };
  return <Screen title="Reading plans" className="study-screen"><div className="personal-study">
    <div className="study-intro"><span className="study-eyebrow">Make time for the Word</span><h2>A little, every day.</h2><p>Choose a collection and a pace that fits your day. Your completed chapters stay marked when you change plans.</p></div>
    {plan && <div className="plan-current"><p><span className="study-eyebrow">Your current plan</span><strong>{plan.name ?? "Whole Bible with Apocrypha"}</strong></p><Link className="study-text-link" to="/plan">Continue reading<Icon name="chevron" size={16} /></Link></div>}
    <div className="plan-pace"><div><strong>Set your daily pace</strong><p>You can choose a different pace for your next plan.</p></div><label><span className="sr-only">Chapters each day</span><select value={pace} onChange={e => setPace(Number(e.target.value))}>{[1, 2, 4, 6].map(n => <option key={n} value={n}>{n} {n === 1 ? "chapter" : "chapters"} / day</option>)}</select></label></div>
    {books.isError && <StudyNotice error>The book list could not be loaded. <Button appearance="plain" onClick={() => void books.refetch()}>Retry</Button></StudyNotice>}
    <div className="study-section-heading"><h2>Choose your path</h2><span>KJV + Apocrypha</span></div>
    <div className="plan-grid">{plans.map((p, i) => { const selected = (books.data ?? []).filter(p.select), count = selected.reduce((n, b) => n + b.chapterIds.length, 0); return <section className="plan-card" key={p.name}><span className="plan-card__icon"><Icon name={i === 0 ? "book-open" : i === 3 ? "quote" : i === 4 ? "law" : "book"} size={22} /></span><h3>{p.name}</h3><p>{p.description}</p><p className="plan-card__length">{count ? `${count.toLocaleString()} ${count === 1 ? "chapter" : "chapters"} · ${Math.ceil(count / pace).toLocaleString()} ${Math.ceil(count / pace) === 1 ? "day" : "days"}` : books.isError ? "Book list unavailable" : books.isPending ? "Loading books…" : "No books available in this collection"}</p><Button appearance="plain" disabled={!count} onClick={() => void start(p.name, selected)} aria-label={`Start ${p.name}`}>Start reading<Icon name="chevron" size={16} /></Button></section>; })}
      <section className="plan-single"><h3>Study a single book</h3><p>Spend time in one book, from its first chapter to its last.</p><label>Choose a book<select value={selectedBook} onChange={e => setSelectedBook(e.target.value)}><option value="" disabled>Select a book</option>{books.data?.map(b => <option key={b.slug} value={b.slug}>{b.book}</option>)}</select></label><div className="study-toolbar"><Button appearance="plain" disabled={!selectedBook} onClick={() => { const b = books.data?.find(b => b.slug === selectedBook); if (b) void start(b.book, [b]); }}>Start this book<Icon name="chevron" size={16} /></Button></div></section>
    </div>
  </div></Screen>;
}
