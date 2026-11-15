import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/time";

/** "Business · Paid until Tue, 15 Dec 2026", or what the business actually gets when unpaid. */
export async function PlanLabel({
  planKey,
  status,
  paidUntil,
}: {
  planKey: string | null;
  status: "free" | "active" | "lapsed" | null;
  paidUntil: Date | null;
}) {
  const t = await getTranslations("admin.plan");
  if (!planKey || !status || status === "free") return <>{t("free")}</>;
  if (status === "lapsed") return <>{`${planKey} · ${t("lapsed")}`}</>;
  if (paidUntil && paidUntil < new Date()) {
    return <>{`${planKey} · ${t("expired", { date: formatDate(paidUntil) })}`}</>;
  }
  return <>{paidUntil ? `${planKey} · ${t("active", { date: formatDate(paidUntil) })}` : planKey}</>;
}
