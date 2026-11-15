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
      <h1 className="title">{t("businesses.title")}</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("businesses.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{t("businesses.name")}</th>
                <th className="px-3 py-2 font-medium">{t("businesses.kind")}</th>
                <th className="px-3 py-2 font-medium">{t("businesses.owner")}</th>
                <th className="px-3 py-2 font-medium">{t("businesses.plan")}</th>
                <th className="px-3 py-2 font-medium">{t("businesses.created")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => {
                const address = row.kind === "salon" ? row.slug && `/${row.slug}` : row.handle && `/@${row.handle}`;
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      <Link href={`/admin/businesses/${row.id}`} className="link">
                        {row.name}
                      </Link>
                      {address ? <span className="block text-muted">{address}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {row.kind === "salon" ? t("businesses.kindSalon") : t("businesses.kindIndependent")}
                    </td>
                    <td className="px-3 py-2">
                      {row.ownerName}
                      <span className="block text-muted">
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
        <p className="text-sm text-muted">{t("limitNote", { count: rows.length })}</p>
      ) : null}
    </div>
  );
}
