import { getDb } from './db';

// In complete implementation this will import `submitChecklist` server action.
// For now, it is a shell to queue and retrieve items.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function enqueue(payload: Record<string, any>) {
  const db = await getDb();
  return db.add('auditQueue', {
    ...payload,
    clientCreatedAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0
  });
}

export async function getQueue() {
  const db = await getDb();
  return db.getAll('auditQueue');
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export async function replay(submitAction: Function) {
  const db = await getDb();
  const tx = db.transaction('auditQueue', 'readwrite');
  const index = tx.store.index('by-status');
  const pending = await index.getAll('pending');
  
  for (const item of pending) {
    item.status = 'syncing';
    await db.put('auditQueue', item);
    try {
      await submitAction(item);
      await db.delete('auditQueue', item.localId!);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      item.attempts += 1;
      item.status = item.attempts >= 5 ? 'failed' : 'pending';
      item.lastError = e.message;
      await db.put('auditQueue', item);
    }
  }
}
