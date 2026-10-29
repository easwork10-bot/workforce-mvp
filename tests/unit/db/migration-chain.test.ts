import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("active migration source", () => {
  it("contains only the four journaled migrations and reads them without a connection", async () => {
    const folder = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(await readFile(path.join(folder, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const tags = [
      "0000_wild_agent_zero",
      "0001_notification_idempotency_expand",
      "0002_retire_notification_legacy_indexes",
      "0003_damp_unus",
    ];
    expect(journal.entries.map(entry => entry.tag)).toEqual(tags);
    expect(journal.entries.map(entry => entry.idx)).toEqual([0, 1, 2, 3]);
    expect((await readdir(folder)).filter(file => file.endsWith(".sql")).sort())
      .toEqual(tags.map(tag => `${tag}.sql`));
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    expect(migrations.map(migration => migration.folderMillis))
      .toEqual(journal.entries.map(entry => entry.when));
    expect(migrations).toHaveLength(4);
    for (const migration of migrations) {
      expect(migration.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(migration.sql.length).toBeGreaterThan(0);
    }
  });
});
