"use client";

import { saveTravelPreferences } from "@/app/actions/settings";
import { ChipSet, Group, SaveBar, SectionCard, Segmented, quietButton, useSectionForm } from "@/components/settings/parts";
import { TextField } from "@/components/forms/fields";
import {
  DIET_NOTE_MAX,
  DIET_OPTIONS,
  INTEREST_OPTIONS,
  PACES,
  PACE_LABELS,
  TRANSPORT_OPTIONS,
  type Diet,
  type SettingsSnapshot,
  type TravelPreferences,
} from "@/lib/settings";

const pick = (s: SettingsSnapshot): TravelPreferences => s.travel;
const NO_PREFERENCE = "none";

export function TravelSection({ saved, onSaved }: { saved: TravelPreferences; onSaved: (snapshot: SettingsSnapshot) => void }) {
  const form = useSectionForm<TravelPreferences>({ saved, save: saveTravelPreferences, pick, onSaved });
  const d = form.draft;

  return (
    <SectionCard
      id="travel"
      title="Travel preferences"
      intro="Optional. These are saved to your account so you only say them once."
    >
      <p className="rounded-xl border border-border bg-secondary/60 p-3 text-sm text-ink">
        Atlas doesn’t use these yet to suggest places or change any plan — nothing on a shared itinerary is ever altered because of them. They are stored for you and shown only in Settings.
      </p>

      <Group label="Dietary preference">
        <Segmented
          name="diet"
          value={(d.diet ?? NO_PREFERENCE) as Diet | typeof NO_PREFERENCE}
          options={[{ value: NO_PREFERENCE, label: "No preference" }, ...(Object.entries(DIET_OPTIONS) as [Diet, string][]).map(([value, label]) => ({ value, label }))]}
          onChange={(v) => form.update({ diet: v === NO_PREFERENCE ? null : (v as Diet) })}
        />
      </Group>

      <TextField
        name="diet_note"
        idPrefix="travel"
        label="Dietary note"
        optional
        maxLength={DIET_NOTE_MAX}
        value={d.diet_note}
        onChange={(e) => form.update({ diet_note: e.target.value })}
        error={form.fieldErrors.diet_note}
        hint={`${d.diet_note.length}/${DIET_NOTE_MAX}. A short reminder for yourself. This is not an allergy record — Atlas doesn’t guess allergies from a dietary choice.`}
        autoComplete="off"
      />

      <Group label="Activity interests" hint="Pick any that sound like you.">
        <ChipSet name="interests" values={d.interests} options={INTEREST_OPTIONS} onChange={(interests) => form.update({ interests })} />
      </Group>

      <Group label="Trip pace">
        <div className="space-y-2">
          <Segmented
            name="pace"
            value={d.pace}
            options={PACES.map((p) => ({ value: p, label: PACE_LABELS[p] }))}
            onChange={(pace) => form.update({ pace })}
          />
          {d.pace ? (
            <button type="button" className={`${quietButton} min-h-11`} onClick={() => form.update({ pace: null })}>
              Clear pace
            </button>
          ) : null}
        </div>
      </Group>

      <Group label="Preferred transport" hint="How you like to get around.">
        <ChipSet name="transport" values={d.transport} options={TRANSPORT_OPTIONS} onChange={(transport) => form.update({ transport })} />
      </Group>

      <SaveBar dirty={form.dirty} status={form.status} saveLabel="Save travel preferences" onSave={() => void form.submit()} onCancel={form.reset} />
    </SectionCard>
  );
}
