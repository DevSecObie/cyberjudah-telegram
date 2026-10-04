import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { DEFAULT_NAV, MAX_NAV, NAV_ITEMS, navItem, useNav, type NavId, type NavItem } from "@/lib/nav";
import { Icon, Screen, Section } from "@/ui/ui";

const Glyph = ({ item }: { item: NavItem }) => item.icon === "count" ? <span className="tab__count" aria-hidden="true">1</span> : <Icon name={item.icon} size={20} />;

/**
 * The bottom bar, as the reader wants it: what is on it and in what order. The bar is Bible Strong's
 * (icons only, the menu last); the choice is each reader's, kept with their other settings.
 */
export function NavEditor() {
  useBackButton(true);
  const [storedIds, setIds] = useNav();
  const ids = storedIds.filter(id => id !== "search");
  const full = ids.length >= MAX_NAV;
  const move = (i: number, by: -1 | 1) => { const next = [...ids]; [next[i], next[i + by]] = [next[i + by], next[i]]; haptic("select"); setIds(next); };
  const remove = (id: NavId) => { if (ids.length > 1) { haptic("select"); setIds(ids.filter((x) => x !== id)); } };
  const add = (id: NavId) => { if (!full) { haptic("select"); setIds([...ids, id]); } };
  const rest = NAV_ITEMS.filter((i) => i.id !== "search" && !ids.includes(i.id));
  const isDefault = ids.join() === DEFAULT_NAV.filter(id => id !== "search").join();
  return (
    <Screen title="Bottom bar" kicker="Settings">
      <p className="hint">Choose up to {MAX_NAV} buttons and their order. Menu follows your choices, and Search always sits last in its own round button. A long press on the bar brings you here.</p>
      <div className="naved__preview" aria-hidden="true">
        {ids.map((id) => <span key={id}><Glyph item={navItem(id)} /></span>)}
        <span><Icon name="more" size={24} /></span>
        <span><Icon name="search" size={22} /></span>
      </div>
      <Section title={`In the bar · ${ids.length} of ${MAX_NAV}`}>
        <ul className="naved">
          {ids.map((id, i) => {
            const item = navItem(id);
            return (
              <li key={id} className="naved__row">
                <span className="naved__icon"><Glyph item={item} /></span>
                <span className="naved__label">{item.label}</span>
                <button type="button" className="naved__btn" aria-label={`Move ${item.label} up`} title={`Move ${item.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" size={18} /></button>
                <button type="button" className="naved__btn naved__btn--down" aria-label={`Move ${item.label} down`} title={`Move ${item.label} down`} disabled={i === ids.length - 1} onClick={() => move(i, 1)}><Icon name="arrowUp" size={18} /></button>
                <button type="button" className="naved__btn naved__btn--remove" aria-label={`Remove ${item.label}`} title={`Remove ${item.label}`} disabled={ids.length === 1} onClick={() => remove(id)}><Icon name="trash" size={18} /></button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={full ? "Remove one to add another" : "Add a button"}>
        <ul className="naved">
          {rest.map((item) => (
            <li key={item.id} className="naved__row">
              <span className="naved__icon"><Glyph item={item} /></span>
              <span className="naved__label">{item.label}</span>
              <button type="button" className="naved__btn naved__btn--add" aria-label={`Add ${item.label}`} title={`Add ${item.label}`} disabled={full} onClick={() => add(item.id)}><Icon name="plus" size={18} /></button>
            </li>
          ))}
        </ul>
      </Section>
      {isDefault ? null : <button type="button" className="naved__reset" onClick={() => { haptic("select"); setIds(DEFAULT_NAV); }}>Back to the default bar</button>}
    </Screen>
  );
}
