"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { formatTimeOfDay } from "@/lib/time";
import {
  addClosureAction,
  addExceptionAction,
  saveBookingRulesAction,
  saveWeeklyHoursAction,
  type HoursFormState,
} from "@/modules/availability/actions";

const initial: HoursFormState = {};

/** Every half hour of the day, plus any saved time that is not on the half hour. */
function timeOptions(extra: number[] = []) {
  const minutes = new Set<number>(extra);
  for (let minute = 0; minute <= 1440; minute += 30) minutes.add(minute);
  return [...minutes].sort((a, b) => a - b);
}

function TimeSelect({
  name,
  value,
  onChange,
  options,
  label,
}: {
  name: string;
  value: number;
  onChange: (minutes: number) => void;
  options: number[];
  label: string;
}) {
  return (
    <label className="field min-w-0 flex-1">
      <span>{label}</span>
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="field-input"
      >
        {options.map((minutes) => (
          <option key={minutes} value={minutes}>
            {formatTimeOfDay(minutes)}
          </option>
        ))}
      </select>
    </label>
  );
}

function FormMessages({ state, pending }: { state: HoursFormState; pending: boolean }) {
  const t = useTranslations("hours");
  return (
    <>
      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {t(`errors.${state.error}` as "errors.invalid_input")}
        </p>
      ) : null}
      {state.saved && !pending ? (
        <p className="text-sm text-primary-dark" role="status">
          {t("saved")}
        </p>
      ) : null}
    </>
  );
}

type ShiftTimes = { start: number; end: number };
type Day = { on: boolean; shifts: ShiftTimes[] };

/** Monday first: the working week starts there. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const USUAL_DAY: ShiftTimes = { start: 9 * 60, end: 18 * 60 };

export function WeeklyHoursForm({
  businessId,
  membershipId,
  shifts,
  dayNames,
}: {
  businessId: string;
  membershipId: string;
  shifts: { weekday: number; startMinute: number; endMinute: number }[];
  /** Sunday first, as weekdays are numbered. */
  dayNames: string[];
}) {
  const t = useTranslations("hours");
  const [state, action, pending] = useActionState(
    saveWeeklyHoursAction.bind(null, businessId, membershipId),
    initial,
  );
  const [days, setDays] = useState<Day[]>(() =>
    Array.from({ length: 7 }, (_, weekday) => {
      const own = shifts
        .filter((shift) => shift.weekday === weekday)
        .map((shift) => ({ start: shift.startMinute, end: shift.endMinute }));
      return { on: own.length > 0, shifts: own.length > 0 ? own.slice(0, 2) : [USUAL_DAY] };
    }),
  );
  const options = timeOptions(shifts.flatMap((shift) => [shift.startMinute, shift.endMinute]));

  const change = (weekday: number, update: (day: Day) => Day) =>
    setDays((current) => current.map((day, index) => (index === weekday ? update(day) : day)));
  const setTime = (weekday: number, shift: number, key: keyof ShiftTimes, minutes: number) =>
    change(weekday, (day) => ({
      ...day,
      shifts: day.shifts.map((times, index) =>
        index === shift ? { ...times, [key]: minutes } : times,
      ),
    }));
  const addBreak = (weekday: number) =>
    change(weekday, (day) => {
      const { start, end } = day.shifts[0]!;
      // A lunch hour at 12:30 when the day spans it; otherwise a second shift after the first.
      return start < 750 && end > 810
        ? { ...day, shifts: [{ start, end: 750 }, { start: 810, end }] }
        : { ...day, shifts: [{ start, end }, { start: end, end: Math.min(end + 120, 1440) }] };
    });
  const removeBreak = (weekday: number) =>
    change(weekday, (day) => ({
      ...day,
      shifts: [{ start: day.shifts[0]!.start, end: day.shifts.at(-1)!.end }],
    }));

  return (
    <form action={action} className="space-y-4">
      <ul className="divide-y divide-line border-y border-line">
        {DAY_ORDER.map((weekday) => {
          const day = days[weekday]!;
          return (
            <li key={weekday} className="space-y-3 py-4">
              <label className="choice">
                <input
                  type="checkbox"
                  name={`d${weekday}_on`}
                  checked={day.on}
                  onChange={(event) => change(weekday, (d) => ({ ...d, on: event.target.checked }))}
                />
                <span>{dayNames[weekday]}</span>
              </label>
              {day.on ? (
                <div className="space-y-3">
                  {day.shifts.map((times, shift) => (
                    <div key={shift} className="space-y-1">
                      {shift > 0 ? (
                        <p className="text-sm text-muted">{t("afterBreak")}</p>
                      ) : null}
                      <div className="flex gap-3">
                        <TimeSelect
                          name={`d${weekday}_s${shift + 1}`}
                          value={times.start}
                          onChange={(minutes) => setTime(weekday, shift, "start", minutes)}
                          options={options}
                          label={t("from")}
                        />
                        <TimeSelect
                          name={`d${weekday}_e${shift + 1}`}
                          value={times.end}
                          onChange={(minutes) => setTime(weekday, shift, "end", minutes)}
                          options={options}
                          label={t("to")}
                        />
                      </div>
                    </div>
                  ))}
                  {day.shifts.length === 1 ? (
                    day.shifts[0]!.end < 1440 ? (
                      <button type="button" onClick={() => addBreak(weekday)} className="link text-sm">
                        {t("addBreak")}
                      </button>
                    ) : null
                  ) : (
                    <button type="button" onClick={() => removeBreak(weekday)} className="link text-sm">
                      {t("removeBreak")}
                    </button>
                  )}
                </div>
              ) : (
                <span className="ml-3 text-sm text-muted">{t("dayOff")}</span>
              )}
            </li>
          );
        })}
      </ul>
      <FormMessages state={state} pending={pending} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? t("saving") : t("saveWeek")}
      </button>
    </form>
  );
}

function OptionalTimeSelect({ name, label }: { name: string; label: string }) {
  const t = useTranslations("hours");
  return (
    <label className="field min-w-0 flex-1">
      <span>{label}</span>
      <select name={name} defaultValue="" className="field-input">
        <option value="">{t("allDay")}</option>
        {timeOptions().map((minutes) => (
          <option key={minutes} value={minutes}>
            {formatTimeOfDay(minutes)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ExceptionForm({
  businessId,
  membershipId,
  today,
}: {
  businessId: string;
  membershipId: string;
  /** The earliest day that can be chosen, on the business's clock. */
  today: string;
}) {
  const t = useTranslations("hours");
  const [state, action, pending] = useActionState(
    addExceptionAction.bind(null, businessId, membershipId),
    initial,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <label className="choice">
          <input type="radio" name="kind" value="time_off" defaultChecked />
          <span>{t("kindTimeOff")}</span>
        </label>
        <label className="choice">
          <input type="radio" name="kind" value="extra_hours" />
          <span>{t("kindExtraHours")}</span>
        </label>
      </div>
      <div className="flex gap-3">
        <label className="field min-w-0 flex-1">
          <span>{t("firstDay")}</span>
          <input type="date" name="startDate" required min={today} className="field-input" />
        </label>
        <label className="field min-w-0 flex-1">
          <span>{t("lastDay")}</span>
          <input type="date" name="endDate" min={today} className="field-input" />
        </label>
      </div>
      <div className="flex gap-3">
        <OptionalTimeSelect name="startMinute" label={t("fromTime")} />
        <OptionalTimeSelect name="endMinute" label={t("toTime")} />
      </div>
      <label className="field">
        <span>{t("note")}</span>
        <input name="note" maxLength={200} className="field-input" />
      </label>
      <FormMessages state={state} pending={pending} />
      <button type="submit" disabled={pending} className="btn btn-quiet">
        {pending ? t("saving") : t("addException")}
      </button>
    </form>
  );
}

export function ClosureForm({ businessId, today }: { businessId: string; today: string }) {
  const t = useTranslations("hours");
  const [state, action, pending] = useActionState(
    addClosureAction.bind(null, businessId),
    initial,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="flex gap-3">
        <label className="field min-w-0 flex-1">
          <span>{t("firstDay")}</span>
          <input type="date" name="startDate" required min={today} className="field-input" />
        </label>
        <label className="field min-w-0 flex-1">
          <span>{t("lastDay")}</span>
          <input type="date" name="endDate" min={today} className="field-input" />
        </label>
      </div>
      <label className="field">
        <span>{t("reason")}</span>
        <input
          name="reason"
          maxLength={120}
          placeholder={t("reasonPlaceholder")}
          className="field-input"
        />
      </label>
      <FormMessages state={state} pending={pending} />
      <button type="submit" disabled={pending} className="btn btn-quiet">
        {pending ? t("saving") : t("addClosure")}
      </button>
    </form>
  );
}

type Choice = { value: number; label: string };

function ChoiceSelect({
  name,
  label,
  hint,
  value,
  choices,
}: {
  name: string;
  label: string;
  hint: string;
  value: number;
  choices: Choice[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={value} className="field-input">
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted">{hint}</span>
    </label>
  );
}

export function BookingRulesForm({
  businessId,
  values,
  noticeChoices,
  advanceChoices,
  travel,
}: {
  businessId: string;
  values: { minNoticeMinutes: number; maxAdvanceDays: number };
  noticeChoices: Choice[];
  advanceChoices: Choice[];
  /** Only in a solo practice: her travel time, saved with the rules. */
  travel: { membershipId: string; minutes: number; choices: Choice[] } | null;
}) {
  const t = useTranslations("hours");
  const [state, action, pending] = useActionState(
    saveBookingRulesAction.bind(null, businessId, travel?.membershipId ?? null),
    initial,
  );

  return (
    <form action={action} className="space-y-4">
      <ChoiceSelect
        name="minNoticeMinutes"
        label={t("minNotice")}
        hint={t("minNoticeHint")}
        value={values.minNoticeMinutes}
        choices={noticeChoices}
      />
      <ChoiceSelect
        name="maxAdvanceDays"
        label={t("maxAdvance")}
        hint={t("maxAdvanceHint")}
        value={values.maxAdvanceDays}
        choices={advanceChoices}
      />
      {travel ? (
        <ChoiceSelect
          name="travelBufferMinutes"
          label={t("travelBuffer")}
          hint={t("travelBufferHint")}
          value={travel.minutes}
          choices={travel.choices}
        />
      ) : null}
      <FormMessages state={state} pending={pending} />
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? t("saving") : t("saveRules")}
      </button>
    </form>
  );
}
