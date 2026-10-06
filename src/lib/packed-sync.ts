/**
 * Save queue behind the packing checkboxes (no React, so it can be tested).
 *
 * Each click records the value the traveler wants and shows it at once.
 * Per item at most one request is in flight; when it returns, the latest
 * wanted value is sent if it differs — so rapid clicks collapse into a
 * short sequence of explicit "set to X" writes, and the last one wins.
 * An item stays "saving" until the final write succeeds. If any write
 * fails, the optimistic value is dropped (the row falls back to the last
 * saved state from the server) and the error is reported.
 */

export type SendResult = { ok: boolean; message?: string };

export type PackedSyncOptions = {
  send: (itemId: string, packed: boolean) => Promise<SendResult>;
  /** Show this state for the item; null = stop overriding, show the saved value. */
  show: (itemId: string, state: { packed: boolean; saving: boolean } | null) => void;
  onError: (itemId: string, message: string | undefined) => void;
};

export function createPackedSync({ send, show, onError }: PackedSyncOptions) {
  const queues = new Map<string, { desired: boolean; inFlight: boolean }>();

  async function flush(itemId: string) {
    const queue = queues.get(itemId)!;
    queue.inFlight = true;
    for (;;) {
      const sending = queue.desired;
      let result: SendResult;
      try {
        result = await send(itemId, sending);
      } catch {
        result = { ok: false, message: "You seem to be offline." };
      }
      if (!result.ok) {
        queues.delete(itemId);
        show(itemId, null);
        onError(itemId, result.message);
        return;
      }
      if (queue.desired === sending) break;
    }
    queues.delete(itemId);
    show(itemId, { packed: queue.desired, saving: false });
  }

  return {
    set(itemId: string, packed: boolean) {
      const queue = queues.get(itemId) ?? { desired: packed, inFlight: false };
      queue.desired = packed;
      queues.set(itemId, queue);
      show(itemId, { packed, saving: true });
      if (!queue.inFlight) return flush(itemId);
      return Promise.resolve();
    },
    isSaving: (itemId: string) => queues.has(itemId),
  };
}
