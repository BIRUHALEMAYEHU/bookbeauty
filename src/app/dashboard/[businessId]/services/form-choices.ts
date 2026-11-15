import "server-only";
import { getTranslations } from "next-intl/server";
import { BUFFER_CHOICES, durationChoices, formatDuration } from "@/lib/duration";

/**
 * The duration and free-time lists for the service form, already worded, so
 * the form does not need the wording sent to the browser. A length saved
 * earlier that is not on the list (an older rule) is kept as a choice.
 */
export async function serviceFormChoices(current?: { durationMinutes: number; bufferMinutes: number }) {
  const [t, tCommon] = await Promise.all([getTranslations("services"), getTranslations("common")]);
  const withCurrent = (list: number[], value?: number) =>
    value === undefined || list.includes(value) ? list : [...list, value].sort((a, b) => a - b);

  return {
    durations: withCurrent(durationChoices(), current?.durationMinutes).map((value) => ({
      value,
      label: formatDuration(value, tCommon),
    })),
    buffers: withCurrent(BUFFER_CHOICES, current?.bufferMinutes).map((value) => ({
      value,
      label: value === 0 ? t("bufferNone") : formatDuration(value, tCommon),
    })),
  };
}
