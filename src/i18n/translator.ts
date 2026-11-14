import { createTranslator } from "next-intl";
import messages from "@/messages/en.json";

/**
 * Text for places outside a page request, such as emails and background jobs.
 * Reads the same message file as the interface (F06).
 */
export function emailText() {
  return createTranslator({ locale: "en", messages, namespace: "emails" });
}
