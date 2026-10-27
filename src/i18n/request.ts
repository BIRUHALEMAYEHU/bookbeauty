import { getRequestConfig } from "next-intl/server";
import { DEFAULT_TIME_ZONE } from "@/lib/time";

// English only at launch (D03). Adding a language means adding a messages file
// and choosing the locale here; no component holds user-facing text (F06).
export default getRequestConfig(async () => {
  const locale = "en";
  return {
    locale,
    timeZone: DEFAULT_TIME_ZONE,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
