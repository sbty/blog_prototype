import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type SqliteDatabase = Database.Database;

export function openDatabase(databasePath: string): SqliteDatabase {
  const resolved = path.resolve(databasePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export async function withMigratedDatabase<T>(
  databasePath: string,
  operation: (db: SqliteDatabase) => T | Promise<T>
): Promise<T> {
  const db = openDatabase(databasePath);
  try {
    migrate(db);
    return await operation(db);
  } finally {
    db.close();
  }
}

export function migrate(db: SqliteDatabase): void {
  db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS blogs (
      blog_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      blog_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      artifact_dir TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (blog_key) REFERENCES blogs(blog_key)
    );

    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      blog_key TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      html TEXT NOT NULL,
      labels_json TEXT NOT NULL,
      search_description TEXT NOT NULL,
      scheduled_at TEXT,
      image_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );

    DROP TRIGGER IF EXISTS job_events_validate_insert;
    DROP TRIGGER IF EXISTS job_events_validate_update;
    DROP TRIGGER IF EXISTS jobs_validate_insert;
    DROP TRIGGER IF EXISTS jobs_validate_update;
    DROP TRIGGER IF EXISTS jobs_validate_transition;
    DROP TRIGGER IF EXISTS articles_validate_insert;
    DROP TRIGGER IF EXISTS articles_validate_update;
    DROP TRIGGER IF EXISTS blogs_validate_insert;
    DROP TRIGGER IF EXISTS blogs_validate_update;

    CREATE TRIGGER IF NOT EXISTS blogs_validate_insert
    BEFORE INSERT ON blogs
    FOR EACH ROW
    WHEN CASE
      WHEN json_valid(NEW.config_json) = 0 THEN 1
      WHEN json_extract(NEW.config_json, '$.blogKey') IS NOT NEW.blog_key THEN 1
      WHEN json_extract(NEW.config_json, '$.displayName') IS NOT NEW.display_name THEN 1
      WHEN json_type(NEW.config_json, '$.dailyPostLimit') <> 'integer' THEN 1
      WHEN json_extract(NEW.config_json, '$.dailyPostLimit') <= 0 THEN 1
      ELSE 0
    END
    BEGIN
      SELECT RAISE(ABORT, 'invalid blog record');
    END;

    CREATE TRIGGER IF NOT EXISTS blogs_validate_update
    BEFORE UPDATE OF blog_key, display_name, config_json ON blogs
    FOR EACH ROW
    WHEN CASE
      WHEN json_valid(NEW.config_json) = 0 THEN 1
      WHEN json_extract(NEW.config_json, '$.blogKey') IS NOT NEW.blog_key THEN 1
      WHEN json_extract(NEW.config_json, '$.displayName') IS NOT NEW.display_name THEN 1
      WHEN json_type(NEW.config_json, '$.dailyPostLimit') <> 'integer' THEN 1
      WHEN json_extract(NEW.config_json, '$.dailyPostLimit') <= 0 THEN 1
      ELSE 0
    END
    BEGIN
      SELECT RAISE(ABORT, 'invalid blog record');
    END;

    CREATE TRIGGER IF NOT EXISTS articles_validate_insert
    BEFORE INSERT ON articles
    FOR EACH ROW
    WHEN CASE
      WHEN json_valid(NEW.labels_json) = 0 THEN 1
      WHEN json_type(NEW.labels_json) <> 'array' THEN 1
      WHEN EXISTS (SELECT 1 FROM json_each(NEW.labels_json) WHERE type <> 'text') THEN 1
      WHEN NEW.scheduled_at IS NOT NULL AND julianday(NEW.scheduled_at) IS NULL THEN 1
      ELSE 0
    END
    BEGIN
      SELECT RAISE(ABORT, 'invalid article record');
    END;

    CREATE TRIGGER IF NOT EXISTS articles_validate_update
    BEFORE UPDATE OF labels_json, scheduled_at ON articles
    FOR EACH ROW
    WHEN CASE
      WHEN json_valid(NEW.labels_json) = 0 THEN 1
      WHEN json_type(NEW.labels_json) <> 'array' THEN 1
      WHEN EXISTS (SELECT 1 FROM json_each(NEW.labels_json) WHERE type <> 'text') THEN 1
      WHEN NEW.scheduled_at IS NOT NULL AND julianday(NEW.scheduled_at) IS NULL THEN 1
      ELSE 0
    END
    BEGIN
      SELECT RAISE(ABORT, 'invalid article record');
    END;

    CREATE TRIGGER IF NOT EXISTS job_events_validate_insert
    BEFORE INSERT ON job_events
    FOR EACH ROW
    WHEN json_valid(NEW.metadata_json) = 0
    BEGIN
      SELECT RAISE(ABORT, 'invalid job event');
    END;

    CREATE TRIGGER IF NOT EXISTS job_events_validate_update
    BEFORE UPDATE OF metadata_json ON job_events
    FOR EACH ROW
    WHEN json_valid(NEW.metadata_json) = 0
    BEGIN
      SELECT RAISE(ABORT, 'invalid job event');
    END;

    CREATE TRIGGER IF NOT EXISTS jobs_validate_insert
    BEFORE INSERT ON jobs
    FOR EACH ROW
    WHEN NEW.mode NOT IN ('dry-run', 'draft', 'schedule')
      OR NEW.status NOT IN (
        'PENDING', 'RUNNING', 'READY_FOR_POST', 'APPROVED_FOR_POST',
        'PREVIEW_CONFIRMED', 'CANCELLED', 'DRY_RUN_DONE', 'DRAFT_SAVED',
        'FAILED', 'STOPPED'
      )
      OR json_valid(NEW.payload_json) = 0
    BEGIN
      SELECT RAISE(ABORT, 'invalid job record');
    END;

    CREATE TRIGGER IF NOT EXISTS jobs_validate_update
    BEFORE UPDATE OF mode, status, payload_json ON jobs
    FOR EACH ROW
    WHEN NEW.mode NOT IN ('dry-run', 'draft', 'schedule')
      OR NEW.status NOT IN (
        'PENDING', 'RUNNING', 'READY_FOR_POST', 'APPROVED_FOR_POST',
        'PREVIEW_CONFIRMED', 'CANCELLED', 'DRY_RUN_DONE', 'DRAFT_SAVED',
        'FAILED', 'STOPPED'
      )
      OR json_valid(NEW.payload_json) = 0
    BEGIN
      SELECT RAISE(ABORT, 'invalid job record');
    END;

    CREATE TRIGGER IF NOT EXISTS jobs_validate_transition
    BEFORE UPDATE OF mode, status ON jobs
    FOR EACH ROW
    WHEN NEW.mode IN ('dry-run', 'draft', 'schedule')
      AND NEW.status IN (
        'PENDING', 'RUNNING', 'READY_FOR_POST', 'APPROVED_FOR_POST',
        'PREVIEW_CONFIRMED', 'CANCELLED', 'DRY_RUN_DONE', 'DRAFT_SAVED',
        'FAILED', 'STOPPED'
      )
      AND (
        NEW.mode <> OLD.mode
        OR (
          NEW.status <> OLD.status
          AND NOT (
            (OLD.status = 'PENDING' AND NEW.status IN ('RUNNING', 'FAILED', 'STOPPED'))
            OR (
              OLD.status = 'RUNNING'
              AND (
                NEW.status IN ('FAILED', 'STOPPED')
                OR (OLD.mode = 'dry-run' AND NEW.status = 'DRY_RUN_DONE')
                OR (OLD.mode = 'draft' AND NEW.status = 'DRAFT_SAVED')
                OR (OLD.mode = 'schedule' AND NEW.status = 'READY_FOR_POST')
              )
            )
            OR (
              OLD.mode = 'schedule'
              AND OLD.status = 'READY_FOR_POST'
              AND NEW.status IN ('APPROVED_FOR_POST', 'CANCELLED')
            )
            OR (
              OLD.mode = 'schedule'
              AND OLD.status = 'APPROVED_FOR_POST'
              AND NEW.status IN ('PREVIEW_CONFIRMED', 'CANCELLED')
            )
            OR (
              OLD.mode = 'schedule'
              AND OLD.status = 'PREVIEW_CONFIRMED'
              AND NEW.status = 'CANCELLED'
            )
          )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'invalid job transition');
    END;
    `);
    const invalidJob = db
      .prepare(
        `
        SELECT id FROM jobs
        WHERE mode NOT IN ('dry-run', 'draft', 'schedule')
          OR status NOT IN (
            'PENDING', 'RUNNING', 'READY_FOR_POST', 'APPROVED_FOR_POST',
            'PREVIEW_CONFIRMED', 'CANCELLED', 'DRY_RUN_DONE', 'DRAFT_SAVED',
            'FAILED', 'STOPPED'
          )
          OR json_valid(payload_json) = 0
        LIMIT 1
      `
      )
      .get() as { id: string } | undefined;
    if (invalidJob) throw new Error(`Invalid existing job record: ${invalidJob.id}`);

    const invalidEvent = db
      .prepare("SELECT id FROM job_events WHERE json_valid(metadata_json) = 0 LIMIT 1")
      .get() as { id: number } | undefined;
    if (invalidEvent) throw new Error(`Invalid existing job event: ${invalidEvent.id}`);

    const invalidArticle = db
      .prepare(
        `
        SELECT id FROM articles
        WHERE CASE
          WHEN json_valid(labels_json) = 0 THEN 1
          WHEN json_type(labels_json) <> 'array' THEN 1
          WHEN EXISTS (SELECT 1 FROM json_each(labels_json) WHERE type <> 'text') THEN 1
          WHEN scheduled_at IS NOT NULL AND julianday(scheduled_at) IS NULL THEN 1
          ELSE 0
        END
        LIMIT 1
      `
      )
      .get() as { id: string } | undefined;
    if (invalidArticle) throw new Error(`Invalid existing article record: ${invalidArticle.id}`);

    const invalidBlog = db
      .prepare(
        `
        SELECT blog_key AS blogKey FROM blogs
        WHERE CASE
          WHEN json_valid(config_json) = 0 THEN 1
          WHEN json_extract(config_json, '$.blogKey') IS NOT blog_key THEN 1
          WHEN json_extract(config_json, '$.displayName') IS NOT display_name THEN 1
          WHEN json_type(config_json, '$.dailyPostLimit') <> 'integer' THEN 1
          WHEN json_extract(config_json, '$.dailyPostLimit') <= 0 THEN 1
          ELSE 0
        END
        LIMIT 1
      `
      )
      .get() as { blogKey: string } | undefined;
    if (invalidBlog) throw new Error(`Invalid existing blog config: ${invalidBlog.blogKey}`);

    const foreignKeyViolations = db.pragma("foreign_key_check") as Array<{
      table: string;
      rowid: number | null;
      parent: string;
      fkid: number;
    }>;
    const foreignKeyViolation = foreignKeyViolations[0];
    if (foreignKeyViolation) {
      throw new Error(
        `Foreign key violation in ${foreignKeyViolation.table} row ${String(foreignKeyViolation.rowid)}`
      );
    }
  })();
}
