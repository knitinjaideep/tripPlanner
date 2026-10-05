import type { StaticImageData } from "next/image";
import beach from "../../public/images/covers/beach.jpg";
import coast from "../../public/images/covers/coast.jpg";
import city from "../../public/images/covers/city.jpg";
import oldtown from "../../public/images/covers/oldtown.jpg";
import mountains from "../../public/images/covers/mountains.jpg";
import lake from "../../public/images/covers/lake.jpg";
import countryside from "../../public/images/covers/countryside.jpg";
import desert from "../../public/images/covers/desert.jpg";

/**
 * Curated trip cover photos, stored locally and served through next/image.
 * They are illustrative scenery chosen by the traveler, not photos of a
 * specific booking. Sources and licences: docs/image-credits.md.
 */
export type Cover = {
  key: string;
  label: string;
  alt: string;
  image: StaticImageData;
  /** CSS object-position keeping the subject in frame when cropped wide. */
  position: string;
  credit: { author: string; license: string; source: string };
};

export const COVERS = [
  {
    key: "beach",
    label: "Beach",
    alt: "Calm turquoise water and white sand at Palm Beach, Aruba",
    image: beach,
    position: "50% 72%",
    credit: {
      author: "Coolcaesar",
      license: "CC BY 4.0",
      source: "https://commons.wikimedia.org/wiki/File:Palm_Beach,_Aruba.jpg",
    },
  },
  {
    key: "coast",
    label: "Rugged coast",
    alt: "Waves breaking on the rocky north coast of Aruba near Natural Bridge",
    image: coast,
    position: "50% 60%",
    credit: {
      author: "Ginelly.Q",
      license: "CC0",
      source: "https://commons.wikimedia.org/wiki/File:Costa_di_Aruba,_Natural_Bridge_Aruba_01.jpg",
    },
  },
  {
    key: "city",
    label: "City",
    alt: "Terracotta rooftops of Alfama above the Tagus river in Lisbon",
    image: city,
    position: "50% 65%",
    credit: {
      author: "Dale Cruse",
      license: "CC BY 4.0",
      source: "https://commons.wikimedia.org/wiki/File:Alfama_Rooftops_and_Tagus_River_View,_Lisbon_(54733828355).jpg",
    },
  },
  {
    key: "oldtown",
    label: "Old town",
    alt: "Yasaka-dori lane and pagoda in early morning, Kyoto",
    image: oldtown,
    position: "50% 55%",
    credit: {
      author: "Basile Morin",
      license: "CC BY-SA 4.0",
      source: "https://commons.wikimedia.org/wiki/File:Yasaka-dori_early_morning_with_street_lanterns_and_the_Tower_of_Yasaka_(Hokan-ji_Temple),_Kyoto,_Japan.jpg",
    },
  },
  {
    key: "mountains",
    label: "Mountains",
    alt: "Snowy peaks reflected in Moraine Lake, Banff National Park",
    image: mountains,
    position: "50% 45%",
    credit: {
      author: "Gorgo",
      license: "Public domain",
      source: "https://commons.wikimedia.org/wiki/File:Moraine_Lake_17092005.jpg",
    },
  },
  {
    key: "lake",
    label: "Lake",
    alt: "Lake Bled and its island church seen from above, Slovenia",
    image: lake,
    position: "50% 60%",
    credit: {
      author: "Adiel lo",
      license: "CC BY-SA 3.0",
      source: "https://commons.wikimedia.org/wiki/File:Bled_Overview.JPG",
    },
  },
  {
    key: "countryside",
    label: "Countryside",
    alt: "Vineyards, olive groves and cypresses in the Chianti hills, Tuscany",
    image: countryside,
    position: "50% 55%",
    credit: {
      author: "bongo vongo",
      license: "CC BY-SA 2.0",
      source: "https://commons.wikimedia.org/wiki/File:A_view_of_the_Chianti_countryside_(4053719563).jpg",
    },
  },
  {
    key: "desert",
    label: "Desert",
    alt: "Camels resting on pale dunes of the Sahara near Merzouga, Morocco",
    image: desert,
    position: "50% 60%",
    credit: {
      author: "Hiroki Ogawa",
      license: "CC BY 3.0",
      source: "https://commons.wikimedia.org/wiki/File:Dunes_Sahara_Merzouga_Morocco_-_panoramio_(3).jpg",
    },
  },
] as const satisfies readonly Cover[];

export type CoverKey = (typeof COVERS)[number]["key"];

export const COVER_KEYS = COVERS.map((c) => c.key) as [CoverKey, ...CoverKey[]];

export const DEFAULT_COVER: CoverKey = "beach";

export function getCover(key: string | null | undefined): Cover {
  return COVERS.find((c) => c.key === key) ?? COVERS[0];
}
