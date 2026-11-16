import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatDate } from "@/lib/time";
import { listCustomers } from "@/modules/customers/records";
import { grantFor } from "@/modules/identity/permissions";
import { currentScope } from "../current-scope";

/** Enough to scroll on a phone; searching finds the rest. */
const SHOWN = 100;

async function Customers({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ businessId }, { q = "" }] = await Promise.all([params, searchParams]);
  const { scope } = await currentScope(businessId);
  const t = await getTranslations("customers");
  const query = q.slice(0, 100);
  const [business, all] = await Promise.all([scope.business(), listCustomers(scope, query)]);
  const ownOnly = grantFor(scope.actor.role, "customers.view") === "own";
  const shown = all.slice(0, SHOWN);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="title">{t("title")}</h1>
        <p className="text-sm text-muted">{ownOnly ? t("subtitleOwn") : t("subtitle")}</p>
      </div>

      <form className="flex gap-2" role="search">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("search")}</span>
          <input
            name="q"
            type="search"
            defaultValue={query}
            placeholder={t("search")}
            maxLength={100}
            className="field-input"
          />
        </label>
        <button type="submit" className="btn btn-quiet flex-none">
          {t("searchButton")}
        </button>
      </form>

      {all.length === 0 ? (
        <p className="border-y border-line py-6 text-muted">
          {query ? t("noMatch", { query }) : ownOnly ? t("emptyOwn") : t("empty")}
        </p>
      ) : (
        <>
          <p className="flex justify-between text-sm text-muted">
            <span>{t("count", { count: all.length })}</span>
            {query ? (
              <Link href={`/dashboard/${businessId}/customers`} className="link">
                {t("clear")}
              </Link>
            ) : null}
          </p>
          <ul className="divide-y divide-line border-y border-line">
            {shown.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/dashboard/${businessId}/customers/${customer.id}`}
                  className="flex items-start justify-between gap-3 py-3 hover:bg-wash"
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-semibold">
                      {customer.name}
                      {customer.allergies ? (
                        <span className="ml-2 rounded bg-warning-tint px-1.5 py-0.5 text-xs font-semibold">
                          {t("allergyFlag")}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-sm text-muted">{formatPhone(customer.phone)}</span>
                    <span className="block text-sm text-muted">
                      {t("visits", { count: customer.visitCount })}
                      {customer.lastVisitAt
                        ? `, ${t("lastVisit", { date: formatDate(customer.lastVisitAt, business.timeZone) })}`
                        : ""}
                      {customer.noShowCount > 0
                        ? `, ${t("noShows", { count: customer.noShowCount })}`
                        : ""}
                    </span>
                  </span>
                  {customer.totalSpent > 0 ? (
                    <span className="flex-none text-sm font-semibold tabular-nums">
                      {formatMoney({ amount: customer.totalSpent, currency: "ETB" })}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Customers params={params} searchParams={searchParams} />
    </Suspense>
  );
}
