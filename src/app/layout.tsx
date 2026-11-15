import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Young_Serif } from "next/font/google";
import "./globals.css";

// The only downloaded font, used for headings. It is served from our own
// address; body text uses the phone's own font (weak connections).
const youngSerif = Young_Serif({
  variable: "--font-young-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${youngSerif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* No interface text is sent to the browser by default; screens with
            interactive forms add only the sections they use (ClientText). */}
        <NextIntlClientProvider messages={null}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
