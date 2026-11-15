import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/time";
import { listBusinessesForAdmin } from "@/modules/platform/admin";
import { PlanLabel } from "../plan-label";
import { requireAdmin } from "../require-admin";

export default async function AdminBusinessesPage() {
  await requireAdmin();
  const t = await getTranslations("admin");
  const rows = await listBusinessesForAdmin();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("businesses.title")}</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">{t("businesses.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="px-3 py-2 font-medium">{t("businesses.name")}</th>
                <th className="px-3 py-2 font-medium">{t("businesses.kind")}</th>
                <th className="px-3 py-2 font-medium">{t("businesses.owner")}</th>
                <th className="px-3 py-2 font-medium">{t("businesses.plan")}</th>
                <th className="px-3 py-2 font-medium">{t("businesses.created")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rows.map((row) => {
                const address = row.kind === "salon" ? row.slug && `/${row.slug}` : row.handle && `/@${row.handle}`;
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      <Link href={`/admin/businesses/${row.id}`} className="font-medium underline">
                        {row.name}
                      </Link>
                      {address ? <span className="block text-neutral-500">{address}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {row.kind === "salon" ? t("businesses.kindSalon") : t("businesses.kindIndependent")}
                    </td>
                    <td className="px-3 py-2">
                      {row.ownerName}
                      <span className="block text-neutral-500">
                        {row.ownerEmail ?? t("businesses.noEmail")}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <PlanLabel planKey={row.planKey} status={row.subscriptionStatus} paidUntil={row.paidUntil} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length >= 200 ? (
        <p className="text-sm text-neutral-500">{t("limitNote", { count: rows.length })}</p>
      ) : null}
    </div>
  );
}
