import { paidAskAvailable } from "./platform";
import { Link } from "react-router";
import { useBackButton } from "@/tg/hooks";
import { Screen, Section } from "@/ui/ui";

/** A saved tab or incoming link must not open a service excluded from the native profile. */
export function NativeReaderNotice() {
  useBackButton();
  return <Screen title="Read and study"><Section title="Free reading and study">
    <p>This edition includes the Bible, study resources and local notes{paidAskAvailable ? " and linked-account Ask" : ""}. This service is not available in this build.</p>
    <Link className="btn btn--prominent" to="/bible">Open the Bible</Link>
  </Section></Screen>;
}

