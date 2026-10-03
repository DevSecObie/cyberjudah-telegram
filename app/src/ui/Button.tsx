import type { ComponentPropsWithoutRef } from "react";

/** Glass is a fill within a navigation material; it never creates another filter. */
export function Button({ appearance = "prominent", size = "md", stretched, className = "", ...props }: ComponentPropsWithoutRef<"button"> & {
  appearance?: "glass" | "prominent" | "bordered" | "plain";
  size?: "sm" | "md" | "lg" | "xl";
  stretched?: boolean;
}) {
  return <button type="button" {...props} className={`btn btn--${appearance} btn--${size}${stretched ? " btn--stretched" : ""} ${className}`} />;
}
