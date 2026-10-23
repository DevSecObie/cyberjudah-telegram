import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { data } from "@/api/data";
import { usePlan, useProgress, type Plan } from "@/lib/marks";
import { cataloguePlan, filterPlans, normalizePlanFilters, PLAN_CATALOGUE, planCompletion, planDays } from "@/lib/plan";
import { useBackButton } from "@/tg/hooks";
import { Feather } from "@/bible/icons";
import { Sheet } from "@/bible/ui/Sheet";
import { Empty, Icon, Row, Screen, SearchField, Section, Loading } from "@/ui/ui";
import { useSheet } from "@/ui/sheet";
import { useAppTheme } from "@/ui/theme";
import { cssVars, PALETTES } from "@/bible/theme";
import "./reading-plans.css";

export function ReadingPlans() {
  useBackButton();
  const { name } = useAppTheme();
  const palette = cssVars(PALETTES[name]);
  const navigate = useNavigate(), sheet = useSheet();
  const [plan] = usePlan(), [progress] = useProgress();
  const [params, setParams] = useSearchParams();
  const filters = normalizePlanFilters(params.get("search"), params.get("language"));
  const setFilters = (patch: Partial<typeof filters>) => { const next = { ...filters, ...patch }; setParams({ ...(next.query ? { search: next.query } : {}), ...(next.language === "all" ? { language: "all" } : {}) }, { replace: true }); };
  const [pace, setPace] = useState(1), [selectedBook, setSelectedBook] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const activeCount = Number(!!filters.query.trim()) + Number(filters.language !== "en");
  const openFilters = async () => {
    const answer = await sheet.open({ title: "Filters", items: [{ id: "search", text: "Search", hint: filters.query || undefined, icon: <Feather name="search" size={20} /> }, { id: "language", text: "Language", hint: filters.language === "en" ? "English" : "All languages", icon: <Feather name="globe" size={20} /> }, ...(activeCount ? [{ id: "reset", text: "Reset" }] : [])] });
    if (answer?.id === "search") setSearchOpen(true);
    if (answer?.id === "reset") setParams({}, { replace: true });
    if (answer?.id === "language") {
      const choice = await sheet.open({ title: "Language", items: [{ id: "all", text: "All languages" }, { id: "en", text: "English" }] });
      if (choice?.id === "all" || choice?.id === "en") setFilters({ language: choice.id });
    }
  };
  const results = filterPlans(PLAN_CATALOGUE, filters);
  const card = (item: NonNullable<Plan>, active: boolean) => {
    const days = planDays(item, books.data ?? [], progress), complete = planCompletion(days);
    return <div className="reading-catalogue__card" style={palette} key={item.catalogId ?? item.name}>
      <Row href={active ? "/plan" : `/plan?catalog=${encodeURIComponent(item.catalogId!)}&pace=${pace}`} leading={<span className="reading-catalogue__image"><Feather name="book-open" size={28} color="var(--bs-primary)" /></span>} title={item.name} sub={<><span className="reading-catalogue__duration">{active ? <span className="reading-catalogue__progress"><i style={{ width: `${days.length ? complete.completed / days.length * 100 : 0}%` }} /></span> : null}{active ? complete.finished ? "Journey completed" : `Day ${Math.min(complete.resume + 1, days.length)} of ${days.length}` : `${days.length} ${days.length === 1 ? "day" : "days"}`}</span><b>{active ? complete.finished ? "Read again" : "Continue my journey" : "Explore this plan"}</b></>} trailing={<Feather name="chevron-right" size={20} color="var(--bs-primary)" />} />
    </div>;
  };
  return <Screen title="Reading plans" className="reading-catalogue" action={<button type="button" className="icon-btn" aria-label={activeCount ? `${activeCount} active filters` : "Filter"} onClick={() => void openFilters()}>{activeCount ? <span className="reading-catalogue__badge">{activeCount}<Feather name="chevron-down" size={13} /></span> : <Icon name="filter" size={20} />}</button>}>
    <div className="reading-catalogue__content">
      {books.isPending ? <Loading /> : books.isError ? <Empty title="The book list could not be loaded." action={{ label: "Retry", onClick: () => void books.refetch() }} /> : <>
        {plan ? <Section title="Your journeys">{card(plan, true)}</Section> : null}
        <Section title="Discover">
          <label className="reading-catalogue__pace">Chapters each day<select aria-label="Chapters each day" value={pace} onChange={e => setPace(+e.target.value)}>{[1, 2, 4, 6].map(n => <option key={n} value={n}>{n} {n === 1 ? "chapter" : "chapters"} / day</option>)}</select></label>
          {!results.length ? <Empty title="No reading plans match these filters." /> : <><h3 className="reading-catalogue__language" style={palette}>English</h3>{results.map(entry => { const item = cataloguePlan(entry.id, books.data, pace)!; const current = !!plan && (plan.catalogId === entry.id || plan.name === entry.name); return card(current ? plan : item, current); })}</>}
        </Section>
        <Section title="Study a single book"><p>Spend time in one book, from its first chapter to its last.</p><label className="reading-catalogue__pace">Choose a book<select aria-label="Choose a book" value={selectedBook} onChange={e => setSelectedBook(e.target.value)}><option value="" disabled>Select a book</option>{books.data.map(b => <option key={b.slug} value={b.slug}>{b.book}</option>)}</select></label><button type="button" className="reading-catalogue__single" disabled={!selectedBook} onClick={() => navigate(`/plan?catalog=${encodeURIComponent(`book:${selectedBook}`)}&pace=${pace}`)}>Explore this plan<Feather name="chevron-right" size={20} /></button></Section>
      </>}
    </div>
    <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Search" headerChildren={<div className="reading-catalogue__search"><SearchField id="plans-search" value={filters.query} onChange={query => setFilters({ query })} placeholder="Search" onSubmit={() => setSearchOpen(false)} autoFocus /></div>}><></></Sheet>
  </Screen>;
}
