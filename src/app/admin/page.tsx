import { getTranslations } from "next-intl/server";
import { getPlatformCounts } from "@/modules/platform/admin";
import { requireAdmin } from "./require-admin";

export default async function AdminOverviewPage() {
  await requireAdmin();
  const t = await getTranslations("admin");
  const counts = await getPlatformCounts();

  const figures = [
    { label: t("counts.users"), value: counts.users },
    { label: t("counts.independents"), value: counts.independents },
    { label: t("counts.salons"), value: counts.salons },
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {figures.map((figure) => (
        <div key={figure.label} className="rounded-md border border-neutral-200 p-4">
          <dt className="text-sm text-neutral-600">{figure.label}</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums">{figure.value}</dd>
        </div>
      ))}
    </dl>
  );
}
