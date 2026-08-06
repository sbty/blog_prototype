import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  migrate,
  openDatabase,
  type SqliteDatabase,
  withMigratedDatabase
} from "../repositories/database.js";

describe("withMigratedDatabase", () => {
  it("migrates and closes the database after success", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "database-lifecycle-"));
    let captured: SqliteDatabase | undefined;
    try {
      await withMigratedDatabase(path.join(dir, "app.sqlite"), (db) => {
        captured = db;
        expect(db.prepare("SELECT COUNT(*) AS count FROM jobs").get()).toEqual({ count: 0 });
        expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
      });
      expect(captured?.open).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("closes the database when the operation fails", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "database-lifecycle-"));
    let captured: SqliteDatabase | undefined;
    try {
      await expect(
        withMigratedDatabase(path.join(dir, "app.sqlite"), (db) => {
          captured = db;
          throw new Error("operation failed");
        })
      ).rejects.toThrow("operation failed");
      expect(captured?.open).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an existing foreign key violation during migration", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "database-lifecycle-"));
    const db = openDatabase(path.join(dir, "app.sqlite"));
    try {
      migrate(db);
      db.pragma("foreign_keys = OFF");
      db.prepare(
        `INSERT INTO jobs (
          id, blog_key, mode, status, payload_json, artifact_dir, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      ).run(
        "orphan-job",
        "missing-blog",
        "dry-run",
        "PENDING",
        "{}",
        "data/jobs/orphan-job",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z"
      );
      db.pragma("foreign_keys = ON");

      expect(() => migrate(db)).toThrow("Foreign key violation in jobs row");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});