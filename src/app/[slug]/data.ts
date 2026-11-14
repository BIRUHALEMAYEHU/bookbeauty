import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { cacheTags } from "@/lib/cache-tags";
import { loadPublicBusinessPage, loadPublicProfilePage } from "@/modules/public/pages";

/**
 * Public pages are opened from social media links, often on weak phone
 * connections, so their data is cached. Edits expire it at once through the
 * tags (src/lib/cache-tags.ts); the hour limit is only a safety net.
 */
export async function publicBusinessPage(slug: string) {
  "use cache";
  cacheLife("hours");
  const page = await loadPublicBusinessPage(slug);
  if (page) cacheTag(cacheTags.business(page.id));
  return page;
}

export async function publicProfilePage(handle: string) {
  "use cache";
  cacheLife("hours");
  const page = await loadPublicProfilePage(handle);
  if (page) {
    cacheTag(cacheTags.profile(page.userId));
    // Her page shows the names of the places she works.
    for (const place of page.places) cacheTag(cacheTags.business(place.businessId));
  }
  return page;
}
