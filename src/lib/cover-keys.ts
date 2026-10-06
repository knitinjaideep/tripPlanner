/** Cover photo keys, kept free of image imports so validation can use them anywhere. */
export const COVER_KEYS = ["beach", "coast", "city", "oldtown", "mountains", "lake", "countryside", "desert"] as const;

export type CoverKey = (typeof COVER_KEYS)[number];
