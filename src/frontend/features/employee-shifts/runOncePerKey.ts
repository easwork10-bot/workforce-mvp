export async function runOncePerKey<T>(
  pending: Set<string>,
  key: string,
  operation: () => Promise<T>
): Promise<{ started: false } | { started: true; value: T }> {
  if (pending.has(key)) return { started: false };

  pending.add(key);
  try {
    return { started: true, value: await operation() };
  } finally {
    pending.delete(key);
  }
}
