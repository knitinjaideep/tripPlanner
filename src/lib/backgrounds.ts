/**
 * The ONE registry of Atlas backgrounds. Settings (thumbnail grid), the
 * availability check and the global renderer all read it; nothing else decides
 * which picture a background means. Pure and client-safe (no I/O).
 *
 * Pictures are WebP conversions of the supplied originals (kept untouched in
 * assets/backgrounds-src/; see scripts/optimize-backgrounds.mjs):
 *   public/backgrounds/<stem>.webp        1920 × 1080 full picture
 *   public/backgrounds/<stem>-thumb.webp   480 ×  270 Settings thumbnail
 *
 * Overlay values are the opacity of an ivory wash painted over the picture.
 * "subtle" washes more, "standard" less. They were chosen from the measured
 * luminance of each picture (scripts/optimize-backgrounds.mjs prints it): the
 * pictures are pale with a calm centre, and the busier the edges the stronger
 * the wash, so body text stays above 4.5:1 even where cards are translucent.
 */

/** The ivory every background sits on, and the fallback when a picture is missing or fails. */
export const IVORY = "#FAF6EC";

export const BACKGROUND_IDS = [
  "plain-ivory",
  "forest-mist",
  "coastal-linen",
  "explorers-map",
  "botanical-light",
  "alpine-dawn",
  "desert-silk",
  "island-breeze",
  "meadow-haze",
  "riverstone",
  "golden-hour",
] as const;
export type BackgroundId = (typeof BACKGROUND_IDS)[number];

export type BackgroundEntry = {
  id: BackgroundId;
  label: string;
  description: string;
  /** Full-size picture, or null for Plain Ivory. */
  url: string | null;
  /** Small Settings thumbnail, or null for Plain Ivory. */
  thumbUrl: string | null;
  /** Colour painted under the picture while it loads. */
  baseColor: string;
  /** CSS background-position on wide screens / on narrow (portrait) screens, where `cover` crops the sides. */
  position: { wide: string; narrow: string };
  /** Opacity (0–1) of the ivory wash over the picture, per background strength. */
  overlay: { subtle: number; standard: number };
};

const picture = (
  id: Exclude<BackgroundId, "plain-ivory">,
  label: string,
  description: string,
  baseColor: string,
  overlay: BackgroundEntry["overlay"],
  position: BackgroundEntry["position"] = { wide: "center bottom", narrow: "30% bottom" },
): BackgroundEntry => ({
  id,
  label,
  description,
  url: `/backgrounds/${id}.webp`,
  thumbUrl: `/backgrounds/${id}-thumb.webp`,
  baseColor,
  position,
  overlay,
});

export const BACKGROUND_REGISTRY: Record<BackgroundId, BackgroundEntry> = {
  "plain-ivory": {
    id: "plain-ivory",
    label: "Plain Ivory",
    description: "Warm ivory, no picture.",
    url: null,
    thumbUrl: null,
    baseColor: IVORY,
    position: { wide: "center", narrow: "center" },
    overlay: { subtle: 0, standard: 0 },
  },
  // Dark pines and rock hug the lower corners; the centre is open fog.
  "forest-mist": picture("forest-mist", "Forest Mist", "Pines in morning fog.", "#fcf5eb", { subtle: 0.58, standard: 0.26 }, { wide: "center bottom", narrow: "12% bottom" }),
  "coastal-linen": picture("coastal-linen", "Coastal Linen", "A quiet shoreline on linen.", "#f8f0e5", { subtle: 0.42, standard: 0.12 }),
  "explorers-map": picture("explorers-map", "Explorer’s Map", "Soft map contours and gold lines.", "#faf6ed", { subtle: 0.34, standard: 0.08 }, { wide: "center", narrow: "50% 50%" }),
  "botanical-light": picture("botanical-light", "Botanical Light", "Leaf shadows on a sunlit wall.", "#f7f0e0", { subtle: 0.5, standard: 0.2 }, { wide: "center top", narrow: "20% top" }),
  "alpine-dawn": picture("alpine-dawn", "Alpine Dawn", "Peaks at first light.", "#faf6eb", { subtle: 0.52, standard: 0.22 }),
  "desert-silk": picture("desert-silk", "Desert Silk", "Rippled dunes in warm sand.", "#fef7ec", { subtle: 0.36, standard: 0.1 }),
  // Palms frame the top corners and bright water fills the bottom: the strongest colour contrast of the set.
  "island-breeze": picture("island-breeze", "Island Breeze", "Palm shadows and clear water.", "#fcf6ea", { subtle: 0.54, standard: 0.22 }, { wide: "center bottom", narrow: "14% 70%" }),
  "meadow-haze": picture("meadow-haze", "Meadow Haze", "Wildflowers in soft mist.", "#f9f5eb", { subtle: 0.52, standard: 0.22 }),
  // Stone shapes with texture fill both lower corners.
  riverstone: picture("riverstone", "Riverstone", "Smooth stone shapes in sage and sand.", "#faf6eb", { subtle: 0.56, standard: 0.24 }, { wide: "center bottom", narrow: "6% bottom" }),
  "golden-hour": picture("golden-hour", "Golden Hour", "Rolling hills in low sun.", "#fbf4e6", { subtle: 0.38, standard: 0.1 }),
};

export const backgroundEntry = (id: BackgroundId): BackgroundEntry => BACKGROUND_REGISTRY[id];
export const backgroundUrl = (id: BackgroundId): string | null => BACKGROUND_REGISTRY[id].url;
export const backgroundThumbUrl = (id: BackgroundId): string | null => BACKGROUND_REGISTRY[id].thumbUrl;

/** Public-folder file names that must exist for a background to be offered (Plain Ivory needs none). */
export const backgroundFiles = (id: BackgroundId): string[] => {
  const { url, thumbUrl } = BACKGROUND_REGISTRY[id];
  return [url, thumbUrl].filter((u): u is string => u !== null).map((u) => u.replace(/^\/backgrounds\//, ""));
};

/**
 * Stored / submitted value → a current id, or null. Accepts the retired
 * underscore spelling ("forest_mist") that the first settings migration used.
 */
export function parseBackgroundId(value: unknown): BackgroundId | null {
  if (typeof value !== "string") return null;
  const id = value.replace(/_/g, "-");
  return (BACKGROUND_IDS as readonly string[]).includes(id) ? (id as BackgroundId) : null;
}
