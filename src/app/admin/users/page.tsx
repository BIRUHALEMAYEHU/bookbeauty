import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/time";
import { listUsersForAdmin } from "@/modules/platform/admin";
import { setUserStatusAction } from "@/modules/platform/admin-actions";
import { requireAdmin } from "../require-admin";

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const admin = await requireAdmin();
  const t = await getTranslations("admin");
  const rows = await listUsersForAdmin();
  const notice = (await searchParams).notice;
  const noticeKey = typeof notice === "string" && t.has(`notices.${notice}`) ? notice : null;
  const good = noticeKey === "user_suspended" || noticeKey === "user_restored";

  return (
    <div className="space-y-4">
      <h1 className="title">{t("users.title")}</h1>
      {noticeKey ? (
        <p
          className={`rounded-md px-3 py-2 text-sm ${good ? "bg-primary-tint text-primary-dark" : "bg-danger-tint text-danger"}`}
          role="status"
        >
          {t(`notices.${noticeKey}`)}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("users.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{t("users.name")}</th>
                <th className="px-3 py-2 font-medium">{t("users.email")}</th>
                <th className="px-3 py-2 font-medium">{t("users.status")}</th>
                <th className="px-3 py-2 font-medium">{t("users.created")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 font-medium">{row.displayName}</td>
                  <td className="px-3 py-2">
                    {row.email ?? t("users.noEmail")}
                    {row.email ? (
                      <span className="block text-muted">
                        {row.emailVerifiedAt ? t("users.verified") : t("users.unverified")}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {row.status === "active" ? t("users.active") : t("users.suspended")}
                    {row.isAdmin ? <span className="block text-muted">{t("users.admin")}</span> : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    {row.status === "suspended" ? (
                      <form action={setUserStatusAction.bind(null, row.id, "active")}>
                        <button type="submit" className="link">
                          {t("users.restore")}
                        </button>
                      </form>
                    ) : row.isAdmin || row.id === admin.id ? null : (
                      <form action={setUserStatusAction.bind(null, row.id, "suspended")}>
                        <button type="submit" className="link">
                          {t("users.suspend")}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
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
