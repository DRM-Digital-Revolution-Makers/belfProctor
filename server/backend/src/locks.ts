const chains = new Map<string, Promise<void>>();

export async function withLock(
  key: string,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(fn)
    .finally(() => {
      if (chains.get(key) === next) {
        chains.delete(key);
      }
    });
  chains.set(key, next);
  await next;
}
