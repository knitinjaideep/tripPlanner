"use client";

import { useState, useTransition } from "react";
import { Loader2, LogOut } from "lucide-react";
import { saveDisplayName } from "@/app/actions/settings";
import { signOut } from "@/app/actions/auth";
import { TextField } from "@/components/forms/fields";
import { SaveBar, SectionCard, quietButton, type SaveStatus } from "@/components/settings/parts";
import { UserAvatar } from "@/components/user-avatar";
import { DISPLAY_NAME_MAX } from "@/lib/settings";

export function AccountSection({
  googleName,
  displayNameOverride,
  email,
  initials,
  avatarUrl,
}: {
  googleName: string;
  displayNameOverride: string | null;
  email: string | null;
  initials: string;
  avatarUrl: string | null;
}) {
  const [savedName, setSavedName] = useState(displayNameOverride ?? "");
  const [name, setName] = useState(displayNameOverride ?? "");
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const [error, setError] = useState<string[] | undefined>();
  const [signingOut, startSignOut] = useTransition();
  const shown = savedName || googleName;
  const dirty = name.trim() !== savedName;

  async function save() {
    setStatus({ state: "saving" });
    setError(undefined);
    try {
      const result = await saveDisplayName(name);
      if (result.ok) {
        const stored = result.displayName ?? "";
        setSavedName(stored);
        setName(stored);
        setStatus({ state: "saved", message: result.message ?? "Saved." });
      } else {
        setError(result.fieldErrors?.display_name);
        setStatus({ state: "error", message: result.message ?? "That didn’t save. Your name is still here — try again.", signedOut: result.signedOut });
      }
    } catch {
      setStatus({ state: "error", message: "We couldn’t reach Atlas, so nothing was saved. Your name is still here — check your connection and try again." });
    }
  }

  return (
    <SectionCard id="account" title="Account" intro="Your sign-in is handled by Google. Atlas never sees a password.">
      <div className="flex items-center gap-4">
        <UserAvatar name={shown} initials={initials} src={avatarUrl} className="size-16 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink">{shown}</p>
          {email ? <p className="truncate text-sm text-muted-foreground">{email}</p> : null}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-[0.9375rem] sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold text-ink">Google email</dt>
          <dd className="break-all text-muted-foreground">{email ?? "Not provided"}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-ink">Connected provider</dt>
          <dd className="text-muted-foreground">Google</dd>
        </div>
      </dl>

      <div className="space-y-3">
        <TextField
          name="display_name"
          idPrefix="account"
          label="Display name"
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          placeholder={googleName}
          onChange={(e) => {
            setName(e.target.value);
            setStatus({ state: "idle" });
            setError(undefined);
          }}
          error={error}
          hint="Shown to the people you travel with. This changes your name in Atlas only, not your Google account. Leave it blank to use your Google name."
          autoComplete="name"
        />
        <SaveBar
          dirty={dirty}
          status={status}
          saveLabel="Save name"
          onSave={() => void save()}
          onCancel={() => {
            setName(savedName);
            setStatus({ state: "idle" });
            setError(undefined);
          }}
        />
      </div>

      <div className="border-t border-border pt-5">
        <button type="button" disabled={signingOut} onClick={() => startSignOut(() => signOut())} className={quietButton}>
          {signingOut ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
        <p className="mt-2 text-sm text-muted-foreground">Signing out also clears anything unsaved from this screen.</p>
      </div>
    </SectionCard>
  );
}
