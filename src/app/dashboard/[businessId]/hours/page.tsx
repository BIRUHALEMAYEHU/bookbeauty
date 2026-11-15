import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { localDateOf } from "@/lib/time";
import { removeClosureAction } from "@/modules/availability/actions";
import {
  getAllWeeklyHours,
  getBookingRules,
  getTravelBuffer,
  listSchedulableMembers,
  listUpcomingClosures,
} from "@/modules/availability/hours";
import { currentScope } from "../current-scope";
import { BookingRulesForm, ClosureForm } from "./hours-forms";
import { describePeriod, ruleChoices, weekSummary } from "./wording";

async function Hours({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { scope } = await currentScope(businessId);
  const t = await getTranslations("hours");

  const [business, members, hours, closures, rules] = await Promise.all([
    scope.business(),
    listSchedulableMembers(scope),
    getAllWeeklyHours(scope),
    listUpcomingClosures(scope),
    getBookingRules(scope),
  ]);
  const canManage = scope.can("staff.manage");
  const solo = business.kind === "independent";
  const today = localDateOf(new Date(), business.timeZone);

  const weeks = await Promise.all(
    members.map(async (member) => ({
      member,
      lines: await weekSummary(hours.get(member.membershipId) ?? []),
    })),
  );
  const closureLines = await Promise.all(
    closures.map(async (closure) => ({
      closure,
      when: await describePeriod(closure.startsAt, closure.endsAt, business.timeZone),
    })),
  );

  // In a solo practice her travel time sits with the rules; there is nobody else to set it for.
  const soloMember = solo ? members[0] : undefined;
  const travelMinutes = soloMember ? await getTravelBuffer(scope, soloMember.membershipId) : 0;
  const choices = await ruleChoices({ ...rules, travelBufferMinutes: travelMinutes });

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="title">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>

      <section className="space-y-3">
        {solo ? <h2 className="title-sm">{t("weekTitle")}</h2> : null}
        {weeks.length === 0 ? (
          <p className="border-y border-line py-5 text-muted">{t("noMembers")}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {weeks.map(({ member, lines }) => (
              <li key={member.membershipId} className="flex items-start justify-between gap-3 py-4">
                <div className="min-w-0 space-y-1">
                  {solo ? null : <p className="font-semibold">{member.displayName}</p>}
                  {lines.length === 0 ? (
                    <p className="text-sm text-danger">{t("noHours")}</p>
                  ) : (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                      {lines.map((line) => (
                        <div key={line.day} className="contents">
                          <dt className="text-muted">{line.day}</dt>
                          <dd>
                            {line.times.map((time) => (
                              <span key={time} className="block">
                                {time}
                              </span>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                {canManage ? (
                  <Link
                    href={`/dashboard/${businessId}/hours/${member.membershipId}`}
                    className="btn btn-quiet btn-small flex-none"
                  >
                    {t("editHours")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="title-sm">{t("closuresTitle")}</h2>
        <p className="text-sm text-muted">{t("closuresHint")}</p>
        {closureLines.length === 0 ? (
          <p className="text-sm text-muted">{t("closuresEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {closureLines.map(({ closure, when }) => (
              <li key={closure.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{when}</p>
                  {closure.reason ? <p className="text-sm text-muted">{closure.reason}</p> : null}
                </div>
                {canManage ? (
                  <form action={removeClosureAction.bind(null, businessId, closure.id)}>
                    <button type="submit" className="btn btn-quiet btn-small">
                      {t("remove")}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="max-w-xl">
            <ClosureForm businessId={businessId} today={today} />
          </div>
        ) : null}
      </section>

      {scope.can("settings.manage") ? (
        <section className="max-w-xl space-y-3">
          <h2 className="title-sm">{t("rulesTitle")}</h2>
          <BookingRulesForm
            businessId={businessId}
            values={rules}
            noticeChoices={choices.notice}
            advanceChoices={choices.advance}
            travel={
              soloMember
                ? {
                    membershipId: soloMember.membershipId,
                    minutes: travelMinutes,
                    choices: choices.travel,
                  }
                : null
            }
          />
        </section>
      ) : null}
    </div>
  );
}

export default function HoursPage({ params }: PageProps<"/dashboard/[businessId]/hours">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Hours params={params} />
    </Suspense>
  );
}
