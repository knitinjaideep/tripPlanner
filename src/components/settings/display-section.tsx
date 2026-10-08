"use client";

import { useCallback } from "react";
import { saveDisplayPreferences } from "@/app/actions/settings";
import { Group, SaveBar, SectionCard, Segmented, useSectionForm } from "@/components/settings/parts";
import { useCommitDisplay } from "@/components/settings/settings-provider";
import { formatClockTime, formatDistance } from "@/lib/display-format";
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode, type DisplayPreferences, type SettingsSnapshot } from "@/lib/settings";

const pick = (s: SettingsSnapshot): DisplayPreferences => s.display;

export function DisplaySection({ saved, onSaved }: { saved: DisplayPreferences; onSaved: (snapshot: SettingsSnapshot) => void }) {
  const commitDisplay = useCommitDisplay();
  const handleSaved = useCallback(
    (snapshot: SettingsSnapshot) => {
      commitDisplay(snapshot.display);
      onSaved(snapshot);
    },
    [commitDisplay, onSaved],
  );
  const form = useSectionForm<DisplayPreferences>({ saved, save: saveDisplayPreferences, pick, onSaved: handleSaved });
  const d = form.draft;

  return (
    <SectionCard
      id="display"
      title="Display preferences"
      intro="How times, distances and money are written for you. They change how things look, never what is stored."
    >
      <Group label="Clock" hint={`Example: ${formatClockTime("18:30", d.clock)}. Times stay in each place’s own time zone — flight and booking times are not converted.`}>
        <Segmented
          name="clock"
          value={d.clock}
          options={[
            { value: "12h", label: "12-hour", hint: "6:30 PM" },
            { value: "24h", label: "24-hour", hint: "18:30" },
          ]}
          onChange={(clock) => form.update({ clock })}
        />
      </Group>

      <Group label="Distance" hint={`Example: ${formatDistance(5000, d.distance)}. Applies to measured distances only — Atlas doesn’t turn driving times into distances.`}>
        <Segmented
          name="distance"
          value={d.distance}
          options={[
            { value: "mi", label: "Miles" },
            { value: "km", label: "Kilometers" },
          ]}
          onChange={(distance) => form.update({ distance })}
        />
      </Group>

      <div className="space-y-1.5">
        <label htmlFor="display-currency" className="text-sm font-semibold text-ink">
          Preferred currency
        </label>
        <select
          id="display-currency"
          value={d.currency}
          onChange={(e) => form.update({ currency: e.target.value as CurrencyCode })}
          aria-describedby="display-currency-hint"
          className="focus-ring h-11 w-full max-w-sm rounded-[10px] border border-input bg-white px-3 text-[0.9375rem] text-ink"
        >
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {code} — {CURRENCIES[code]}
            </option>
          ))}
        </select>
        <p id="display-currency-hint" className="text-sm text-muted-foreground">
          Atlas doesn’t convert currencies. Amounts keep the currency they were saved or published in (Explore prices stay in US dollars). This choice is the starting currency for amounts you type in yourself.
        </p>
      </div>

      <SaveBar dirty={form.dirty} status={form.status} saveLabel="Save display preferences" onSave={() => void form.submit()} onCancel={form.reset} />
    </SectionCard>
  );
}
