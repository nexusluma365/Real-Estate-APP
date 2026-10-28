import { type Client, type InValue } from '@libsql/client';

/** Adapts the local SQLite test client to the API's database interface. */
export function sqlDatabase(client: Pick<Client, 'execute'>): SqlDatabase {
  const toArgs = (values: unknown[]): InValue[] => values.map((value) =>
    value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value as InValue,
  );
  const toRows = (result: { columns: string[]; rows: ArrayLike<unknown>[] }) =>
    result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, (row as unknown[])[index]])));
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const execute = () => client.execute({ sql, args: toArgs(values) });
          return {
            async first<T>() {
              return (toRows(await execute())[0] as T) ?? null;
            },
            async all<T>() {
              return { results: toRows(await execute()) as T[] };
            },
            async run() {
              return { meta: { changes: (await execute()).rowsAffected } };
            },
          };
        },
      };
    },
  };
}
