/**
 * Names for cached public data. A change to a business or profile calls
 * updateTag() with the matching name so its public page shows the change at once.
 */
export const cacheTags = {
  business: (businessId: string) => `business:${businessId}`,
  profile: (userId: string) => `profile:${userId}`,
};
