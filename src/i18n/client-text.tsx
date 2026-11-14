import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

/**
 * Sends only the named sections of en.json to the browser, for the client
 * components below it. Public pages render on the server and send none, which
 * keeps them light on weak phone connections.
 */
export async function ClientText({
  sections,
  children,
}: {
  sections: string[];
  children: React.ReactNode;
}) {
  const all = await getMessages();
  const picked = Object.fromEntries(sections.filter((key) => key in all).map((key) => [key, all[key]!]));
  return <NextIntlClientProvider messages={picked}>{children}</NextIntlClientProvider>;
}
