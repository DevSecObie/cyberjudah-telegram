import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { data } from "@/api/data";
import { usePlan, useProgress, type Plan } from "@/lib/marks";
import { cataloguePlan, filterPlans, normalizePlanFilters, PLAN_CATALOGUE, planCompletion, planDays } from "@/lib/plan";
import { useBackButton } from "@/tg/hooks";
import { Feather } from "@/bible/icons";
import { Empty, List, Row, Screen, Section, Loading } from "@/ui/ui";
import "./reading-plans.css";

export function ReadingPlans() {
  useBackButton();
  const navigate = useNavigate();
  const [plan] = usePlan(), [progress] = useProgress();
  const [params] = useSearchParams();
  const filters = normalizePlanFilters(params.get("search"), params.get("language"));
  const [pace] = useState(1), [selectedBook, setSelectedBook] = useState("");
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const results = filterPlans(PLAN_CATALOGUE, filters);
  const card = (item: NonNullable<Plan>, active: boolean) => {
    const days = planDays(item, books.data ?? [], progress), complete = planCompletion(days);
    return <div className="reading-catalogue__card" key={item.catalogId ?? item.name}>
      <Row href={active ? "/plan" : `/plan?catalog=${encodeURIComponent(item.catalogId!)}&pace=${pace}`} leading={<span className="reading-catalogue__image"><Feather name="book-open" size={28} color="var(--bs-primary)" /></span>} title={item.name} sub={<><span className="reading-catalogue__duration">{active ? <span className="reading-catalogue__progress"><i style={{ width: `${days.length ? complete.completed / days.length * 100 : 0}%` }} /></span> : null}{active ? complete.finished ? "Journey completed" : `Day ${Math.min(complete.resume + 1, days.length)} of ${days.length}` : `${days.length} ${days.length === 1 ? "day" : "days"}`}</span><b>{active ? complete.finished ? "Read again" : "Continue my journey" : "Explore this plan"}</b></>} trailing={<Feather name="chevron-right" size={20} color="var(--bs-primary)" />} />
    </div>;
  };
  return <Screen title="Reading plans" className="reading-catalogue">
    <div className="reading-catalogue__content">
      {books.isPending ? <Loading /> : books.isError ? <Empty title="The book list could not be loaded." action={{ label: "Retry", onClick: () => void books.refetch() }} /> : <>
        {plan ? <Section title="Your journeys">{card(plan, true)}</Section> : null}
        <Section title="Discover">
          {!results.length ? <Empty title="No reading plans match these filters." /> : <><h3 className="reading-catalogue__language">English</h3><List>{results.map(entry => { const item = cataloguePlan(entry.id, books.data, pace)!; const current = !!plan && (plan.catalogId === entry.id || plan.name === entry.name); return card(current ? plan : item, current); })}</List></>}
        </Section>
        <Section title="Study a single book"><p>Spend time in one book, from its first chapter to its last.</p><label className="reading-catalogue__pace">Choose a book<select aria-label="Choose a book" value={selectedBook} onChange={e => setSelectedBook(e.target.value)}><option value="" disabled>Select a book</option>{books.data.map(b => <option key={b.slug} value={b.slug}>{b.book}</option>)}</select></label><button type="button" className="reading-catalogue__single" disabled={!selectedBook} onClick={() => navigate(`/plan?catalog=${encodeURIComponent(`book:${selectedBook}`)}&pace=${pace}`)}>Explore this plan<Feather name="chevron-right" size={20} /></button></Section>
      </>}
    </div>
  </Screen>;
}
