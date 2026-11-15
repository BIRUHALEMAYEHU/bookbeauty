import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/time";
import { listActivityForScope, type ActivityRow } from "@/modules/audit/log";
import { currentScope } from "../current-scope";

/** Names of the fields whose value differs between before and after. */
function changedFields(row: ActivityRow): string[] {
  if (!row.before || !row.after) return [];
  const before = row.before;
  const after = row.after;
  return Object.keys(after).filter(
    (key) => key in before && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );
}

async function Activity({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { scope } = await currentScope(businessId);
  if (!scope.can("activity_log.view")) notFound();

  const t = await getTranslations("activity");
  const [rows, business] = await Promise.all([listActivityForScope(scope), scope.business()]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="title">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ol className="divide-y divide-line rounded-md border border-line">
          {rows.map((row) => {
            // Dots mean nesting in the text file, so "business.created" is stored as "business_created".
            const actionKey = `actions.${row.action.replaceAll(".", "_")}`;
            const fields = changedFields(row)
              .map((field) => (t.has(`fields.${field}`) ? t(`fields.${field}`) : field))
              .join(", ");
            return (
              <li key={row.id} className="space-y-1 px-4 py-3">
                <p className="font-medium">{t.has(actionKey) ? t(actionKey) : row.action}</p>
                {fields ? <p className="text-sm text-muted">{t("changed", { fields })}</p> : null}
                <p className="text-sm text-muted">
                  {formatDateTime(row.createdAt, business.timeZone)}{" "}
                  {t("by", { name: row.actorName ?? t("bySystem") })}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function ActivityPage({ params }: PageProps<"/dashboard/[businessId]/activity">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Activity params={params} />
    </Suspense>
  );
}
