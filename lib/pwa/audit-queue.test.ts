import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { enqueue, getQueue } from './audit-queue';
import { getDb } from './db';

describe('audit-queue', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.clear('auditQueue');
  });

  it('enqueues payload', async () => {
    const localId = await enqueue({ siteId: '123', shift: 'Pagi', items: [] });
    const items = await getQueue();
    expect(items.length).toBe(1);
    expect(items[0].status).toBe('pending');
  });
});
