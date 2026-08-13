import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { enqueue, getQueue, replay } from './audit-queue';
import { getDb } from './db';

const basePayload = {
  siteId: '1',
  userId: '1',
  checkDate: '2026-08-07',
  checkTime: '14:32',
  shift: 'Pagi' as const,
  items: [],
};

describe('audit-queue', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.clear('auditQueue');
  });

  it('enqueues payload as pending', async () => {
    await enqueue(basePayload);
    const items = await getQueue();
    expect(items.length).toBe(1);
    expect(items[0].status).toBe('pending');
    expect(items[0].attempts).toBe(0);
  });

  it('replay builds FormData and deletes on success', async () => {
    const submitAction = vi.fn().mockResolvedValue({ success: true });
    await enqueue({ ...basePayload, items: [{ deviceId: '5', status: 'OK', remarks: 'fine' }] });
    await replay(submitAction);

    const [call] = submitAction.mock.calls;
    const fd = call[1] as FormData;
    expect(fd.get('checkDate')).toBe('2026-08-07');
    expect(fd.get('shift')).toBe('Pagi');
    expect(fd.getAll('deviceId')).toEqual(['5']);
    expect(fd.get('status-5')).toBe('OK');
    expect((await getQueue()).length).toBe(0);
  });

  it('replay re-queues on failure and caps at 5 attempts -> failed', async () => {
    const submitAction = vi.fn().mockResolvedValue({ message: 'Session expired' });
    await enqueue({ ...basePayload, items: [{ deviceId: '7', status: 'NOT OK', remarks: 'bad' }] });

    // 4 retries: stays pending, attempts climbs
    for (let i = 0; i < 4; i++) await replay(submitAction);
    let items = await getQueue();
    expect(items[0].status).toBe('pending');
    expect(items[0].attempts).toBe(4);
    expect(items[0].lastError).toBe('Session expired');

    // 5th failure -> failed, no further auto-retry
    await replay(submitAction);
    items = await getQueue();
    expect(items[0].status).toBe('failed');
    expect(items[0].attempts).toBe(5);
    // failed entries are skipped by replay's pending-only index scan
    const before = (await getQueue()).length;
    await replay(submitAction);
    expect((await getQueue()).length).toBe(before);
  });

  it('replay reconstructs File from stored photo', async () => {
    const photo = new File(['bytes'], 'evidence.jpg', { type: 'image/jpeg' });
    const submitAction = vi.fn().mockResolvedValue({ success: true });
    await enqueue({ ...basePayload, items: [{ deviceId: '9', status: 'NOT OK', remarks: 'heat', photoFile: photo }] });
    await replay(submitAction);

    const fd = submitAction.mock.calls[0][1] as FormData;
    const sent = fd.get('photo-9') as File;
    expect(sent).toBeInstanceOf(File);
    expect(sent.name).toBe('evidence.jpg');
    expect(sent.type).toBe('image/jpeg');
  });

  it('concurrent same-shift enqueues both', async () => {
    await enqueue(basePayload);
    await enqueue(basePayload);
    const items = await getQueue();
    expect(items.length).toBe(2);
  });
});
