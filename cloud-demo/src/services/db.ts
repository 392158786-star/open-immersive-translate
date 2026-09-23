import { Pool } from "pg";
import type { RdsConfig } from "../config.ts";

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface Database {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  close(): Promise<void>;
}

/**
 * Create the PostgreSQL pool used by the RDS persistence layer.
 * The pool is lazy: no connection is opened until a query is executed.
 */
export function createDatabase(config: RdsConfig): Database {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return {
    async query<Row>(text: string, values?: readonly unknown[]) {
      const result =
        values === undefined
          ? await pool.query(text)
          : await pool.query(text, [...values]);
      return {
        rows: result.rows as Row[],
        rowCount: result.rowCount,
      };
    },
    async close() {
      await pool.end();
    },
  };
}
