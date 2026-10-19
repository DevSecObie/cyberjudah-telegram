import { haptic } from "@/tg/sdk";
import { Icon } from "@/ui/ui";

/** Bible Strong's header share: an icon button beside the title, not a bar over the dock. */
export function ShareButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="icon-btn" aria-label="Share" title="Share" onClick={() => { haptic("select"); onClick(); }}><Icon name="share" size={20} /></button>;
}
