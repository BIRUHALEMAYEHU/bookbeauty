import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatPhone } from "@/lib/phone";
import type { PublicBusinessPage, PublicProfilePage } from "@/modules/public/pages";
import { publicBusinessPage, publicProfilePage } from "./data";

// Render the whole page before sending it: data is cached, and a missing page
// then gets a real 404 and link previews see the finished page.
export const instant = false;

/** "/@hana" is a professional's page (D16); anything else is a business slug. */
function parseAddress(raw: string): { kind: "profile" | "business"; value: string } {
  const decoded = decodeURIComponent(raw);
  return decoded.startsWith("@")
    ? { kind: "profile", value: decoded.slice(1) }
    : { kind: "business", value: decoded };
}

async function load(raw: string) {
  const address = parseAddress(raw);
  return address.kind === "profile"
    ? { kind: "profile" as const, page: await publicProfilePage(address.value) }
    : { kind: "business" as const, page: await publicBusinessPage(address.value) };
}

export async function generateMetadata({ params }: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await load(slug);
  if (!result.page) return {};
  if (result.kind === "profile") {
    return {
      title: `${result.page.displayName} (@${result.page.handle})`,
      description: result.page.bio ?? undefined,
    };
  }
  return { title: result.page.name, description: result.page.about ?? undefined };
}

export default async function PublicPage({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  const result = await load(slug);
  if (!result.page) notFound();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-8 px-4 py-8">
      {result.kind === "profile" ? (
        <ProfileView page={result.page as PublicProfilePage} />
      ) : (
        <BusinessView page={result.page as PublicBusinessPage} />
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

function PhoneLink({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone}`} className="underline">
      {formatPhone(phone)}
    </a>
  );
}

async function BusinessView({ page }: { page: PublicBusinessPage }) {
  const t = await getTranslations("public");
  const tCategory = await getTranslations("onboarding.categories");

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{page.name}</h1>
        <p className="text-neutral-600">{tCategory(page.category)}</p>
      </header>

      {page.about ? (
        <Section title={t("about")}>
          <p className="whitespace-pre-line">{page.about}</p>
        </Section>
      ) : null}

      <Section title={page.locations.length > 1 ? t("locations") : t("location")}>
        <ul className="space-y-1">
          {page.locations.map((location) => (
            <li key={location.name}>
              <span className="font-medium">{location.name}</span>
              {location.addressText ? (
                <span className="text-neutral-600">{` · ${location.addressText}`}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {page.phone ? (
        <Section title={t("contact")}>
          <PhoneLink phone={page.phone} />
        </Section>
      ) : null}

      {page.team.length > 0 ? (
        <Section title={t("team")}>
          <ul className="flex flex-wrap gap-2">
            {page.team.map((member) => (
              <li key={member.handle}>
                <Link
                  href={`/@${member.handle}`}
                  className="inline-block rounded-full border border-neutral-300 px-3 py-1 text-sm hover:border-neutral-500"
                >
                  {member.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

async function ProfileView({ page }: { page: PublicProfilePage }) {
  const t = await getTranslations("public");

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{page.displayName}</h1>
        <p className="text-neutral-600">@{page.handle}</p>
      </header>

      {page.bio ? <p className="whitespace-pre-line">{page.bio}</p> : null}

      {page.places.length > 0 ? (
        <Section title={t("whereToBook", { name: page.displayName })}>
          <ul className="space-y-3">
            {page.places.map((place) => (
              <li key={place.businessId} className="rounded-md border border-neutral-200 px-4 py-3">
                {place.kind === "salon" ? (
                  <Link href={`/${place.slug}`} className="font-medium underline">
                    {place.name}
                  </Link>
                ) : (
                  <div className="space-y-1">
                    <p className="font-medium">{t("ownPractice")}</p>
                    {place.location?.addressText ? (
                      <p className="text-sm text-neutral-600">{place.location.addressText}</p>
                    ) : null}
                    {place.phone ? (
                      <p className="text-sm">
                        <PhoneLink phone={place.phone} />
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
