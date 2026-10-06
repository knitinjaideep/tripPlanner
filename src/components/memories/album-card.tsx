"use client";

import { useState } from "react";
import { ExternalLink, Images, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removeTripAlbum, saveTripAlbum } from "@/app/actions/memories";
import { FormMessage, SubmitButton, TextField, secondaryButtonClass } from "@/components/forms/fields";
import { useFormAction } from "@/components/forms/use-form-action";
import { ConfirmDialog } from "@/components/trip/confirm-dialog";
import type { ActionState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EditDialog, useDirty } from "./edit-dialog";

const smallButton =
  "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-lavender-ink hover:bg-white/60";

/** Which service the link points at — a label only; nothing is fetched. */
function albumHost(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "photos.app.goo.gl" || host === "photos.google.com") return "Google Photos";
    if (host === "drive.google.com") return "Google Drive";
    if (host.endsWith("icloud.com")) return "iCloud";
    if (host.endsWith("dropbox.com")) return "Dropbox";
    if (host.endsWith("onedrive.live.com") || host === "1drv.ms") return "OneDrive";
    return host;
  } catch {
    return null;
  }
}

/**
 * A link to the family's album, kept elsewhere. rove only stores and opens
 * the link — it never uploads, imports or looks inside the album.
 */
export function AlbumCard({ tripId, url, className }: { tripId: string; url: string | null; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [session, setSession] = useState(0);
  const [removing, setRemoving] = useState(false);
  const edit = () => {
    setSession((s) => s + 1);
    setEditing(true);
  };
  const host = url ? albumHost(url) : null;

  return (
    <section aria-labelledby="album-heading" className={cn("flex flex-col rounded-2xl bg-lavender p-5 sm:p-6", className)}>
      <h2 id="album-heading" className="eyebrow flex items-center gap-2 text-lavender-ink">
        <Images className="size-4" aria-hidden="true" /> Photo album
      </h2>
      {url ? (
        <>
          <p className="font-display mt-3 text-[1.375rem] leading-snug font-semibold text-ink">Your photos live here.</p>
          {host ? <p className="mt-1 truncate text-sm text-[#4f4a63]">{host}</p> : null}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-lavender-ink px-5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4a3b86]"
          >
            Open photo album <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <p className="mt-3 text-xs text-[#4f4a63]">
            A link only — rove can’t see what’s inside, and who can open it is set where the album lives.
          </p>
          <div className="mt-auto flex flex-wrap gap-1 pt-3">
            <button type="button" onClick={edit} className={cn(smallButton, "-ml-2.5")}>
              <Pencil className="size-4" aria-hidden="true" /> Change link
            </button>
            <button type="button" onClick={() => setRemoving(true)} className={smallButton}>
              <Trash2 className="size-4" aria-hidden="true" /> Remove
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-[#4f4a63]">
            Keep your Google Photos or Drive album one tap away. rove stores the link only — your photos stay where they are.
          </p>
          <button
            type="button"
            onClick={edit}
            className="focus-ring mt-5 inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border-[1.5px] border-lavender-ink px-5 text-[0.9375rem] font-semibold text-lavender-ink transition-colors hover:bg-white/60"
          >
            <Plus className="size-4" aria-hidden="true" /> Add album link
          </button>
        </>
      )}

      {editing ? <AlbumDialog key={session} tripId={tripId} url={url} onClose={() => setEditing(false)} /> : null}

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove the album link?"
        description="Only the link is removed from rove. The album and its photos are not touched."
        confirmLabel="Remove link"
        pendingLabel="Removing…"
        onConfirm={async () => {
          const result = await removeTripAlbum(tripId);
          if (result.ok) {
            toast.success(result.message);
            setRemoving(false);
          } else {
            toast.error(result.message ?? "Couldn’t remove the link.");
          }
        }}
      />
    </section>
  );
}

function AlbumDialog({ tripId, url, onClose }: { tripId: string; url: string | null; onClose: () => void }) {
  const { dirty, markDirty } = useDirty();
  const { state, onSubmit, pending } = useFormAction(async (prev: ActionState, formData: FormData) => {
    const result = await saveTripAlbum(tripId, prev, formData);
    if (result.ok) {
      toast.success(result.message);
      onClose();
    }
    return result;
  });

  return (
    <EditDialog
      open
      onClose={onClose}
      dirty={dirty}
      pending={pending}
      title={url ? "Change album link" : "Add your photo album"}
      description="Paste a share link (https://) from Google Photos, Google Drive or another service."
    >
      {(requestClose) => (
        <form onSubmit={onSubmit} onInput={markDirty} noValidate className="space-y-4">
          <FormMessage message={state.ok ? undefined : state.message} signedOut={state.signedOut} />
          <TextField
            idPrefix="album"
            name="photo_album_url"
            label="Album link"
            type="url"
            inputMode="url"
            autoComplete="off"
            required
            defaultValue={url ?? ""}
            placeholder="https://photos.app.goo.gl/…"
            error={state.fieldErrors?.photo_album_url}
            hint="Anyone you share it with needs access to the album itself."
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={requestClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <SubmitButton pending={pending} pendingLabel="Saving…">
              Save link
            </SubmitButton>
          </div>
        </form>
      )}
    </EditDialog>
  );
}
