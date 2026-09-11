// A serializable Firestore double: transaction writes commit together, after reads.
export function memoryFirestore(rows = new Map()) {
  let tail = Promise.resolve();
  const copy = (value) => value === undefined ? undefined : structuredClone(value);
  function doc(path) {
    const ref = {
      path, id: path.split('/').at(-1),
      collection: (name) => collection(`${path}/${name}`),
      get: async () => ({ exists: rows.has(path), id: ref.id, ref, data: () => copy(rows.get(path)) }),
      set: async (value, options) => rows.set(path, options?.merge ? { ...rows.get(path), ...copy(value) } : copy(value)),
      update: async (value) => {
        if (!rows.has(path)) throw new Error('Missing document');
        rows.set(path, { ...rows.get(path), ...copy(value) });
      },
      delete: async () => rows.delete(path),
    };
    return ref;
  }
  function collection(path, filters = [], maximum = Infinity) {
    return {
      doc: (id) => doc(`${path}/${id}`),
      where: (field, op, value) => collection(path, [...filters, { field, op, value }], maximum),
      limit: (value) => collection(path, filters, value),
      get: async () => {
        const matches = [...rows].filter(([key, row]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')
          && filters.every(({ field, op, value }) => op === '<=' ? row[field] <= value : row[field] === value)).slice(0, maximum);
        const docs = await Promise.all(matches.map(([key]) => doc(key).get()));
        return { docs, empty: docs.length === 0 };
      },
    };
  }
  return {
    rows, collection,
    runTransaction(fn) {
      const run = tail.then(async () => {
        const writes = [];
        const result = await fn({
          get: (ref) => {
            if (writes.length) throw new Error('Firestore reads must precede writes');
            return ref.get();
          },
          set: (ref, data, options) => writes.push(() => ref.set(data, options)),
          update: (ref, data) => writes.push(() => ref.update(data)),
          delete: (ref) => writes.push(() => ref.delete()),
        });
        for (const write of writes) await write();
        return result;
      });
      tail = run.catch(() => {});
      return run;
    },
  };
}
