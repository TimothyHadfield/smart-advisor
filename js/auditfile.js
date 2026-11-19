// The audit file the student last submitted (Import audit → Apply), kept on THIS device only (IndexedDB), so the
// account menu can open the exact file again. Tim, 2026-11-19: "could you also add somewhere in the account menu that
// says "view submitted audit" and that pulls up the exact file that you submitted to it?"
// Never synced or uploaded (Import audit's promise: "Read on this device only. Nothing is uploaded.").
//   { kind: 'pdf' | 'text', name, type, data: ArrayBuffer | string, saved: ISO date }
const DB = 'smart-advisor-files', STORE = 'files', KEY = 'audit';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

/** Keep the submitted audit: a File/Blob (PDF) or the pasted text. Errors are swallowed (private mode, no room). */
export async function saveAudit(src) {
  try {
    const rec = typeof src === 'string'
      ? { kind: 'text', name: 'Pasted audit.txt', type: 'text/plain', data: src, saved: new Date().toISOString() }
      // the bytes, not the Blob: WebKit refuses Blobs in IndexedDB in some sessions (private browsing)
      : { kind: 'pdf', name: src.name || 'Audit.pdf', type: src.type || 'application/pdf', data: await src.arrayBuffer(), saved: new Date().toISOString() };
    await tx('readwrite', (s) => s.put(rec, KEY));
    return true;
  } catch { return false; }
}
/** The saved audit record, or null. */
export async function loadAudit() {
  try { return (await tx('readonly', (s) => s.get(KEY))) || null; } catch { return null; }
}
/** A blob: URL that shows it (PDF as itself, pasted text as plain text). */
export function auditURL(rec) {
  if (!rec) return '';
  const blob = rec.kind === 'text' ? new Blob([rec.data], { type: 'text/plain;charset=utf-8' })
    : rec.data instanceof Blob ? rec.data : rec.data ? new Blob([rec.data], { type: rec.type || 'application/pdf' }) : null;
  return blob ? URL.createObjectURL(blob) : '';
}
