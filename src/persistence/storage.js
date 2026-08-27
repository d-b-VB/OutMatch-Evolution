export async function inspectStorage({
  storage = globalThis.navigator?.storage,
  requestPersistence = false
} = {}) {
  if (!storage || typeof storage.estimate !== "function") {
    throw new Error("Storage Manager API is unavailable in this environment");
  }
  const estimate = await storage.estimate();
  const persistedBefore = typeof storage.persisted === "function" ? await storage.persisted() : null;
  let persisted = persistedBefore;
  if (requestPersistence && persistedBefore === false && typeof storage.persist === "function") {
    persisted = await storage.persist();
  }
  const usage = Number.isFinite(estimate.usage) ? estimate.usage : 0;
  const quota = Number.isFinite(estimate.quota) ? estimate.quota : 0;
  return {
    usage,
    quota,
    available: Math.max(0, quota - usage),
    usageRatio: quota > 0 ? usage / quota : null,
    persisted
  };
}
