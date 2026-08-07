import { getDb, type QueuedAudit } from './db';

// ponytail: append-only, no dedup. If duplicate-shift becomes a real problem,
// add UNIQUE(siteId,checkDate,shift) at DB level (rung 3), surface error to user on replay.
export async function enqueue(payload: Omit<QueuedAudit, 'localId' | 'clientCreatedAt' | 'status' | 'attempts'>) {
  const db = await getDb();
  return db.add('auditQueue', {
    ...payload,
    clientCreatedAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
  });
}

export async function getQueue() {
  const db = await getDb();
  return db.getAll('auditQueue');
}

// Build FormData matching <ChecklistForm> field names so submitChecklist reads it unchanged.
// submitChecklist(prevState, formData) — server action is RPC'd when imported into a client.
function auditToFormData(audit: QueuedAudit): FormData {
  const fd = new FormData();
  fd.set('checkDate', audit.checkDate);
  fd.set('checkTime', audit.checkTime);
  fd.set('shift', audit.shift);
  for (const item of audit.items) {
    fd.append('deviceId', item.deviceId);
    fd.set(`status-${item.deviceId}`, item.status);
    fd.set(`remarks-${item.deviceId}`, item.remarks || '');
    if (item.photoFile) {
      // Reconstruct File from stored File/Blob so arrayBuffer() works server-side.
      const file = new File([item.photoFile], item.photoFile.name || `photo-${item.deviceId}.jpg`, {
        type: item.photoFile.type || 'image/jpeg',
      });
      fd.set(`photo-${item.deviceId}`, file);
    }
  }
  return fd;
}

// submitAction must be the submitChecklist server action imported into a client component
// (Next auto-creates the RPC). We call it with (undefined, formData) to match
// useActionState(prevState, formData) signature.
export async function replay(
  submitAction: (prevState: unknown, formData: FormData) => Promise<{ success?: boolean; message?: string }>,
) {
  const db = await getDb();
  const tx = db.transaction('auditQueue', 'readwrite');
  const index = tx.store.index('by-status');
  const pending = await index.getAll('pending');

  for (const item of pending) {
    item.status = 'syncing';
    await tx.store.put(item);
    try {
      const result = await submitAction(undefined, auditToFormData(item));
      if (result?.success) {
        await tx.store.delete(item.localId!);
      } else {
        item.attempts += 1;
        item.status = item.attempts >= 5 ? 'failed' : 'pending';
        item.lastError = result?.message || 'Server rejected audit';
        await tx.store.put(item);
      }
    } catch (e: unknown) {
      item.attempts += 1;
      item.status = item.attempts >= 5 ? 'failed' : 'pending';
      item.lastError = e instanceof Error ? e.message : String(e);
      await tx.store.put(item);
    }
  }
  await tx.done;
}
