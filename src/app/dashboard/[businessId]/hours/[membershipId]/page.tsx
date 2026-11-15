import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { localDateOf } from "@/lib/time";
import { removeExceptionAction } from "@/modules/availability/actions";
import {
  getWeeklyHours,
  listSchedulableMembers,
  listUpcomingExceptions,
} from "@/modules/availability/hours";
import { currentScope } from "../../current-scope";
import { ExceptionForm, WeeklyHoursForm } from "../hours-forms";
import { describePeriod, weekdayNames } from "../wording";

async function MemberHours({
  params,
}: {
  params: Promise<{ businessId: string; membershipId: string }>;
}) {
  const { businessId, membershipId } = await params;
  const { scope } = await currentScope(businessId);
  if (!scope.can("staff.manage")) notFound();

  const member = (await listSchedulableMembers(scope)).find(
    (candidate) => candidate.membershipId === membershipId,
  );
  if (!member) notFound();

  const t = await getTranslations("hours");
  const [business, shifts, exceptions, dayNames] = await Promise.all([
    scope.business(),
    getWeeklyHours(scope, membershipId),
    listUpcomingExceptions(scope, membershipId),
    weekdayNames(),
  ]);
  const solo = business.kind === "independent";
  const exceptionLines = await Promise.all(
    exceptions.map(async (exception) => ({
      exception,
      when: await describePeriod(exception.startsAt, exception.endsAt, business.timeZone),
    })),
  );

  return (
    <div className="max-w-xl space-y-8">
      <div className="space-y-2">
        <Link href={`/dashboard/${businessId}/hours`} className="link text-sm">
          {t("back")}
        </Link>
        <h1 className="title">
          {solo ? t("weekTitle") : t("weekTitleFor", { name: member.displayName })}
        </h1>
      </div>

      <WeeklyHoursForm
        businessId={businessId}
        membershipId={membershipId}
        shifts={shifts}
        dayNames={dayNames}
      />

      <section className="space-y-3">
        <h2 className="title-sm">{t("exceptionsTitle")}</h2>
        {exceptionLines.length === 0 ? (
          <p className="text-sm text-muted">{t("exceptionsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {exceptionLines.map(({ exception, when }) => (
              <li key={exception.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-muted">
                    {exception.kind === "time_off" ? t("kindTimeOff") : t("kindExtraHours")}
                  </p>
                  <p className="font-semibold">{when}</p>
                  {exception.note ? <p className="text-sm text-muted">{exception.note}</p> : null}
                </div>
                <form
                  action={removeExceptionAction.bind(null, businessId, membershipId, exception.id)}
                >
                  <button type="submit" className="btn btn-quiet btn-small">
                    {t("remove")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <ExceptionForm
          businessId={businessId}
          membershipId={membershipId}
          today={localDateOf(new Date(), business.timeZone)}
        />
      </section>
    </div>
  );
}

export default function MemberHoursPage({
  params,
}: PageProps<"/dashboard/[businessId]/hours/[membershipId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <MemberHours params={params} />
    </Suspense>
  );
}
