/** Account-scoped content stays on this device until the creator explicitly validates it. */
export async function draftStore(
  account: string,
  value?: unknown,
): Promise<any> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("amoji-creator-drafts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("drafts");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "drafts",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("drafts");
      const req =
        value === undefined
          ? store.get(account)
          : value === null
            ? store.delete(account)
            : store.put(value, account);
      let result: unknown;
      req.onsuccess = () => (result = req.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
