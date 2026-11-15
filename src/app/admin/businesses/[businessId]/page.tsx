import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/time";
import { getBusinessForAdmin } from "@/modules/platform/admin";
import { moveToFreeAction, recordPaymentAction } from "@/modules/platform/admin-actions";
import { PlanLabel } from "../../plan-label";
import { requireAdmin } from "../../require-admin";

const input = "w-full rounded-md border border-neutral-300 px-3 py-2";
const METHODS = ["telebirr", "bank_transfer", "cash", "other"] as const;

export default async function AdminBusinessPage({
  params,
  searchParams,
}: PageProps<"/admin/businesses/[businessId]">) {
  await requireAdmin();
  const { businessId } = await params;
  if (!z.uuid().safeParse(businessId).success) notFound();
  const business = await getBusinessForAdmin(businessId);
  if (!business) notFound();

  const t = await getTranslations("admin");
  const notice = (await searchParams).notice;
  const noticeKey = typeof notice === "string" && t.has(`notices.${notice}`) ? notice : null;
  const good = noticeKey === "payment_recorded" || noticeKey === "moved_to_free";

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-sm">
          <Link href="/admin/businesses" className="underline">
            {t("business.back")}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{business.name}</h1>
        <p className="text-sm text-neutral-600">
          {t("business.owner")}: {business.ownerName}
          {business.ownerEmail ? ` (${business.ownerEmail})` : ""}
        </p>
        <p className="text-sm text-neutral-600">
          {t("business.currentPlan")}:{" "}
          <PlanLabel
            planKey={business.planKey}
            status={business.subscriptionStatus}
            paidUntil={business.paidUntil}
          />
        </p>
      </div>

      {noticeKey ? (
        <p
          className={`rounded-md px-3 py-2 text-sm ${good ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}
          role="status"
        >
          {t(`notices.${noticeKey}`)}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium">{t("business.recordTitle")}</h2>
        {business.paidPlans.length === 0 ? (
          <p className="text-sm text-neutral-600">{t("business.noPaidPlans")}</p>
        ) : (
          <form action={recordPaymentAction.bind(null, business.id)} className="max-w-md space-y-3">
            <p className="text-sm text-neutral-600">{t("business.recordHint")}</p>
            <label className="block space-y-1 text-sm">
              <span>{t("business.planField")}</span>
              <select name="planKey" required className={input}>
                {business.paidPlans.map((plan) => (
                  <option key={plan.key} value={plan.key}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>{t("business.amount")}</span>
              <input name="amount" type="number" min="1" step="0.01" required className={input} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>{t("business.method")}</span>
              <select name="method" required className={input}>
                {METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(`business.methods.${method}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>{t("business.reference")}</span>
              <input name="reference" maxLength={200} className={input} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>{t("business.paidUntil")}</span>
              <input name="paidUntil" type="date" required className={input} />
            </label>
            <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
              {t("business.record")}
            </button>
          </form>
        )}
      </section>

      {business.subscriptionStatus && business.subscriptionStatus !== "free" ? (
        <section className="space-y-2">
          <form action={moveToFreeAction.bind(null, business.id)}>
            <button type="submit" className="rounded-md border border-neutral-300 px-4 py-2 text-sm">
              {t("business.moveToFree")}
            </button>
          </form>
          <p className="text-sm text-neutral-600">{t("business.moveToFreeHint")}</p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium">{t("business.paymentsTitle")}</h2>
        {business.payments.length === 0 ? (
          <p className="text-sm text-neutral-600">{t("business.noPayments")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
            {business.payments.map((payment) => (
              <li key={payment.id} className="space-y-1 px-4 py-3 text-sm">
                <p className="font-medium">
                  {t("business.paymentLine", {
                    amount: formatMoney({ amount: payment.amount, currency: payment.currency }),
                    method: t(`business.methods.${payment.method}`),
                    until: payment.periodCovered
                      ? formatDate(new Date(`${payment.periodCovered}T12:00:00+03:00`))
                      : "",
                  })}
                </p>
                {payment.reference ? <p className="text-neutral-700">{payment.reference}</p> : null}
                <p className="text-neutral-500">
                  {t("business.recordedBy", {
                    name: payment.recordedBy,
                    date: formatDateTime(payment.recordedAt),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
