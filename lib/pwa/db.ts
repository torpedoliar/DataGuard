import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface DataGuardDB extends DBSchema {
  auditQueue: {
    key: number;
    value: {
      localId?: number;
      clientCreatedAt: string;
      siteId: string;
      userId: string;
      checkDate: string;
      checkTime: string;
      shift: string;
      items: Array<{ deviceId: string; status: string; remarks: string; photoBlob?: Blob }>;
      status: 'pending' | 'syncing' | 'failed';
      attempts: number;
      lastError?: string;
    };
    indexes: { 'by-status': string };
  };
  readCache: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: { url: string; data: any; fetchedAt: number; ttlMs: number };
  };
  meta: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  };
}

let dbPromise: Promise<IDBPDatabase<DataGuardDB>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<DataGuardDB>('dataguard-pwa', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('auditQueue')) {
          const store = db.createObjectStore('auditQueue', { keyPath: 'localId', autoIncrement: true });
          store.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('readCache')) {
          db.createObjectStore('readCache', { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      },
    });
  }
  return dbPromise;
}
