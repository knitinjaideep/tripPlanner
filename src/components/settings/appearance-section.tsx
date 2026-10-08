"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, ImageOff } from "lucide-react";
import { useAppearance } from "@/components/settings/settings-provider";
import { Group, Segmented, SectionCard, quietButton } from "@/components/settings/parts";
import { BACKGROUND_IDS, BACKGROUND_REGISTRY, type BackgroundId } from "@/lib/backgrounds";
import { preloadBackground } from "@/lib/background-preload";
import { defaultAppearance, sameAppearance } from "@/lib/settings";
import { cn } from "@/lib/utils";

/**
 * Appearance. The choices live in the shared appearance controller
 * (settings-provider): every click only updates the DRAFT, which the whole app
 * previews instantly and keeps while you move between pages. Nothing is written
 * until Save, which (with Cancel) lives in the single global preview bar under
 * the header — there is deliberately no second Save bar here.
 */
export function AppearanceSection() {
  const a = useAppearance();
  const current = a.draft ?? a.saved;
  const savedUnavailable = !a.available.includes(a.saved.background);

  return (
    <SectionCard
      id="appearance"
      title="Appearance"
      intro="Choose how Atlas looks for you. Other travelers on your trips keep their own look."
    >
      <p role="note" className="rounded-xl border border-border bg-secondary p-3 text-sm text-ink">
        {a.previewing
          ? "Previewing — the whole app is showing this draft, and it stays while you look at other pages. Use Save or Cancel in the bar at the top."
          : "Pick a background to preview it across the whole app. Nothing is saved until you choose Save."}
      </p>
      {savedUnavailable ? (
        <p className="rounded-xl border border-border bg-secondary p-3 text-sm text-ink">
          Your saved background ({BACKGROUND_REGISTRY[a.saved.background].label}) isn’t available right now, so Atlas is showing Plain Ivory.
        </p>
      ) : null}

      <Group label="Background" hint={a.everSaved ? undefined : "This is Atlas’s default. Pick another and save to make it yours."}>
        <div role="radiogroup" aria-label="Background" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {BACKGROUND_IDS.map((id) => (
            <BackgroundChoice
              key={id}
              id={id}
              selected={current.background === id}
              unavailable={!a.available.includes(id)}
              disabled={a.locked}
              onSelect={() => a.edit({ background: id })}
            />
          ))}
        </div>
      </Group>

      <Group label="Background strength" hint="Subtle keeps the picture quiet behind your trips; Standard lets it show more.">
        <Segmented
          name="intensity"
          value={current.intensity}
          disabled={a.locked}
          options={[
            { value: "subtle", label: "Subtle" },
            { value: "standard", label: "Standard" },
          ]}
          onChange={(intensity) => a.edit({ intensity })}
        />
      </Group>

      <Group label="Density" hint="Compact tightens spacing on screens used with a mouse or trackpad. Touch screens keep full-size buttons.">
        <Segmented
          name="density"
          value={current.density}
          disabled={a.locked}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
          onChange={(density) => a.edit({ density })}
        />
      </Group>

      <Group label="Decorative mascot" hint="The Atlas character in welcome and empty screens. It is only decoration; Atlas’s logo and icons stay.">
        <Segmented
          name="mascot"
          value={current.mascot}
          disabled={a.locked}
          options={[
            { value: "show", label: "Show" },
            { value: "hide", label: "Hide" },
          ]}
          onChange={(mascot) => a.edit({ mascot })}
        />
      </Group>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={cn(quietButton)}
          disabled={a.locked || sameAppearance(current, defaultAppearance(a.available))}
          onClick={a.restoreDefaults}
        >
          Restore defaults
        </button>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">“Restore defaults” changes the preview only — choose Save to keep it.</p>
      </div>
    </SectionCard>
  );
}

function BackgroundChoice({ id, selected, unavailable, disabled, onSelect }: { id: BackgroundId; selected: boolean; unavailable: boolean; disabled: boolean; onSelect: () => void }) {
  const info = BACKGROUND_REGISTRY[id];
  const thumb = info.thumbUrl;
  const [broken, setBroken] = useState(false);
  const missing = unavailable || broken;
  return (
    <label
      className={cn(
        "group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border-2 bg-white has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-moss/40 has-[:focus-visible]:ring-offset-2",
        selected ? "border-moss-ink" : "border-input hover:border-moss",
        (missing || disabled) && "cursor-not-allowed opacity-80",
      )}
      // Looking at a choice is a reason to fetch its full picture, so selecting it feels instant.
      onPointerEnter={() => !missing && !disabled && void preloadBackground(id)}
      onFocusCapture={() => !missing && !disabled && void preloadBackground(id)}
    >
      <input
        type="radio"
        name="background"
        value={id}
        checked={selected}
        disabled={missing || disabled}
        onChange={onSelect}
        className="sr-only"
        aria-describedby={`bg-${id}-note`}
      />
      <span className="relative block aspect-video w-full bg-background" aria-hidden="true">
        {thumb && !missing ? (
          <Image src={thumb} alt="" fill sizes="(min-width: 640px) 200px, 45vw" className="object-cover" unoptimized onError={() => setBroken(true)} />
        ) : missing ? (
          <span className="absolute inset-0 grid place-items-center bg-[repeating-linear-gradient(45deg,#f3eee1,#f3eee1_8px,#e9e2cf_8px,#e9e2cf_16px)]">
            <ImageOff className="size-6 text-muted-foreground" />
          </span>
        ) : (
          <span className="absolute inset-0 bg-background" />
        )}
        {selected ? (
          <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-moss-ink text-white shadow">
            <Check className="size-4" />
          </span>
        ) : null}
      </span>
      <span className="block px-2.5 py-2">
        <span className="block text-sm font-semibold text-ink">{info.label}</span>
        <span id={`bg-${id}-note`} className="block text-xs text-muted-foreground">
          {missing ? "Unavailable right now" : selected ? "Selected" : info.description}
        </span>
      </span>
    </label>
  );
}
