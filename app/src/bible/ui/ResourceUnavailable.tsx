import { Feather } from "../icons";

export function ResourceUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bs-unavailable" role="status">
      <div className="bs-unavailable__content">
        <Feather name="wifi-off" size={72} color="var(--bs-tertiary)" />
        <p className="bs-unavailable__title">This did not load.</p>
        <p className="bs-unavailable__detail">This resource is temporarily unavailable. Try again shortly.</p>
        <button type="button" className="bs-unavailable__retry" onClick={onRetry}>Retry</button>
      </div>
    </div>
  );
}
