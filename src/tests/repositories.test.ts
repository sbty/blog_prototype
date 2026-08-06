import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArticleRepository } from "../repositories/articleRepository.js";
import { BlogRepository } from "../repositories/blogRepository.js";
import { migrate, openDatabase } from "../repositories/database.js";
import { JobRepository } from "../repositories/jobRepository.js";

function tempDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "blogger-auto-"));
  const db = openDatabase(path.join(dir, "app.sqlite"));
  migrate(db);
  return db;
}

describe("repositories", () => {
  it("stores blog config and job lifecycle", () => {
    const db = tempDb();
    const blogs = new BlogRepository(db);
    const jobs = new JobRepository(db);
    const articles = new ArticleRepository(db);

    blogs.upsert({
      blogKey: "blog-1",
      displayName: "Test Blog",
      adminUrl: "https://www.blogger.com/",
      primaryTheme: "international affairs",
      language: "ja",
      targetCountry: "JP",
      targetAudience: [],
      topicClusters: [],
      excludedTopics: [],
      contentPolicy: {
        evergreenRatio: 0.55,
        durableExplainerRatio: 0.25,
        seasonalRatio: 0.1,
        newsRatio: 0.1
      },
      targetLength: { min: 3000, max: 5000 },
      dailyPostLimit: 1,
      blogger: { selectorsPath: "./config/blogger-selectors.json" }
    });

    const storedBlog = blogs.findConfig("blog-1")!;
    expect(() => blogs.upsert({ ...storedBlog, dailyPostLimit: 0 })).toThrow();
    expect(() =>
      db.prepare("UPDATE blogs SET config_json = '{' WHERE blog_key = ?").run("blog-1")
    ).toThrow("invalid blog record");
    expect(() =>
      db
        .prepare(
          "UPDATE blogs SET config_json = json_set(config_json, '$.blogKey', 'other') WHERE blog_key = ?"
        )
        .run("blog-1")
    ).toThrow("invalid blog record");

    const validBlogJson = JSON.stringify(storedBlog);
    db.exec("DROP TRIGGER blogs_validate_insert; DROP TRIGGER blogs_validate_update;");
    db.prepare("UPDATE blogs SET config_json = '{' WHERE blog_key = ?").run("blog-1");
    expect(() => blogs.findConfig("blog-1")).toThrow("Invalid persisted blog config JSON");
    expect(() => migrate(db)).toThrow("Invalid existing blog config: blog-1");
    db.prepare("UPDATE blogs SET config_json = ? WHERE blog_key = ?").run(
      validBlogJson,
      "blog-1"
    );
    migrate(db);

    const job = jobs.create({
      id: "job-1",
      blogKey: "blog-1",
      mode: "dry-run",
      payload: { title: "Hello" },
      artifactDir: "data/jobs/job-1"
    });
    expect(job.status).toBe("PENDING");

    jobs.updateStatus("job-1", "RUNNING", "started");
    jobs.updateStatus("job-1", "DRY_RUN_DONE", "done");
    expect(jobs.find("job-1")?.status).toBe("DRY_RUN_DONE");
    expect(jobs.fail("job-1", new Error("late failure"))).toBe(false);
    expect(jobs.stop("job-1", new Error("late stop"))).toBe(false);
    expect(jobs.find("job-1")?.status).toBe("DRY_RUN_DONE");
    const lateEvents = db
      .prepare(
        "SELECT COUNT(*) AS count FROM job_events WHERE job_id = ? AND event_type IN ('FAILED', 'STOPPED')"
      )
      .get("job-1") as { count: number };
    expect(lateEvents.count).toBe(0);
    expect(blogs.findConfig("blog-1")?.displayName).toBe("Test Blog");

    const raceJob = jobs.create({
      id: "job-race",
      blogKey: "blog-1",
      mode: "schedule",
      payload: {},
      artifactDir: "data/jobs/job-race"
    });
    jobs.updateStatus(raceJob.id, "RUNNING", "started");
    jobs.updateStatus(raceJob.id, "READY_FOR_POST", "ready");
    const stale = jobs.find(raceJob.id)!;
    jobs.updateStatus(raceJob.id, "APPROVED_FOR_POST", "approved");
    const originalFind = jobs.find.bind(jobs);
    vi.spyOn(jobs, "find").mockReturnValueOnce(stale).mockImplementation(originalFind);

    expect(() => jobs.updateStatus(raceJob.id, "CANCELLED", "stale cancel")).toThrow(
      "Job state changed concurrently"
    );
    expect(jobs.find(raceJob.id)?.status).toBe("APPROVED_FOR_POST");
    const staleEvents = db
      .prepare("SELECT COUNT(*) AS count FROM job_events WHERE job_id = ? AND message = ?")
      .get(raceJob.id, "stale cancel") as { count: number };
    expect(staleEvents.count).toBe(0);

    expect(() =>
      jobs.create({
        id: "job-invalid-mode",
        blogKey: "blog-1",
        mode: "invalid" as never,
        payload: {},
        artifactDir: "data/jobs/job-invalid-mode"
      })
    ).toThrow("Invalid job mode");
    expect(() =>
      jobs.create({
        id: "job-invalid-payload",
        blogKey: "blog-1",
        mode: "draft",
        payload: 1n,
        artifactDir: "data/jobs/job-invalid-payload"
      })
    ).toThrow("JSON-serializable");

    const eventSpy = vi.spyOn(jobs, "addEvent").mockImplementationOnce(() => {
      throw new Error("event insert failed");
    });
    expect(() =>
      jobs.create({
        id: "job-atomic-create",
        blogKey: "blog-1",
        mode: "draft",
        payload: {},
        artifactDir: "data/jobs/job-atomic-create"
      })
    ).toThrow("event insert failed");
    eventSpy.mockRestore();
    expect(jobs.find("job-atomic-create")).toBeNull();

    const transitionJob = jobs.create({
      id: "job-db-transition",
      blogKey: "blog-1",
      mode: "draft",
      payload: {},
      artifactDir: "data/jobs/job-db-transition"
    });
    expect(() =>
      db
        .prepare("UPDATE jobs SET status = 'APPROVED_FOR_POST' WHERE id = ?")
        .run(transitionJob.id)
    ).toThrow("invalid job transition");
    expect(() =>
      db.prepare("UPDATE jobs SET mode = 'schedule' WHERE id = ?").run(transitionJob.id)
    ).toThrow("invalid job transition");
    expect(jobs.find(transitionJob.id)).toMatchObject({ mode: "draft", status: "PENDING" });

    const storedArticle = {
      id: "article-db-validation",
      jobId: transitionJob.id,
      blogKey: "blog-1",
      title: "Stored article",
      html: "<p>body</p>",
      labels: ["safe"],
      searchDescription: "description",
      slug: "stored-article",
      scheduledAt: "2026-08-01T00:00:00.000Z"
    };
    articles.create(storedArticle);
    expect(() => articles.create({ ...storedArticle, id: "bad-labels", labels: [1] as never })).toThrow(
      "array of strings"
    );
    expect(() =>
      articles.create({ ...storedArticle, id: "bad-date", scheduledAt: "not-a-date" })
    ).toThrow("valid date-time");
    expect(() =>
      db.prepare("UPDATE articles SET labels_json = '{}' WHERE id = ?").run(storedArticle.id)
    ).toThrow("invalid article record");
    expect(() =>
      db.prepare("UPDATE articles SET scheduled_at = 'not-a-date' WHERE id = ?").run(
        storedArticle.id
      )
    ).toThrow("invalid article record");

    db.exec("DROP TRIGGER articles_validate_insert; DROP TRIGGER articles_validate_update;");
    db.prepare("UPDATE articles SET labels_json = '{}' WHERE id = ?").run(storedArticle.id);
    expect(() => migrate(db)).toThrow(`Invalid existing article record: ${storedArticle.id}`);
    db.prepare("UPDATE articles SET labels_json = '[]' WHERE id = ?").run(storedArticle.id);
    migrate(db);

    db.exec(`
      DROP TRIGGER jobs_validate_transition;
      CREATE TRIGGER jobs_validate_transition
      BEFORE UPDATE OF status ON jobs
      BEGIN
        SELECT RAISE(ABORT, 'stale trigger');
      END;
    `);
    migrate(db);
    const transitionTrigger = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get("jobs_validate_transition") as { sql: string };
    expect(transitionTrigger.sql).toContain("invalid job transition");
    expect(transitionTrigger.sql).not.toContain("stale trigger");

    expect(() => jobs.addEvent(transitionJob.id, "BAD_METADATA", "bad", 1n)).toThrow(
      "Job event metadata must be JSON-serializable"
    );
    expect(() =>
      db
        .prepare(
          "INSERT INTO job_events (job_id, event_type, message, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run(transitionJob.id, "BAD_JSON", "bad", "{", new Date().toISOString())
    ).toThrow("invalid job event");
    expect(() =>
      db.prepare("UPDATE job_events SET metadata_json = '{' WHERE job_id = ?").run(
        transitionJob.id
      )
    ).toThrow("invalid job event");

    expect(() =>
      db.prepare("UPDATE jobs SET status = 'CORRUPT' WHERE id = ?").run(raceJob.id)
    ).toThrow("invalid job record");
    expect(() =>
      db.prepare("UPDATE jobs SET mode = 'unknown' WHERE id = ?").run(raceJob.id)
    ).toThrow("invalid job record");
    expect(() =>
      db.prepare("UPDATE jobs SET payload_json = '{' WHERE id = ?").run(raceJob.id)
    ).toThrow("invalid job record");

    db.exec(
      "DROP TRIGGER jobs_validate_insert; DROP TRIGGER jobs_validate_update; DROP TRIGGER jobs_validate_transition;"
    );
    db.prepare("UPDATE jobs SET status = 'CORRUPT' WHERE id = ?").run(raceJob.id);
    expect(() => jobs.find(raceJob.id)).toThrow("Invalid persisted job status");
    db.prepare("UPDATE jobs SET status = 'APPROVED_FOR_POST', mode = 'unknown' WHERE id = ?").run(
      raceJob.id
    );
    expect(() => jobs.find(raceJob.id)).toThrow("Invalid persisted job mode");
    db.prepare("UPDATE jobs SET mode = 'schedule', payload_json = '{' WHERE id = ?").run(
      raceJob.id
    );
    expect(() => jobs.find(raceJob.id)).toThrow("Invalid persisted job payload JSON");
    expect(() => migrate(db)).toThrow(`Invalid existing job record: ${raceJob.id}`);

    db.prepare("UPDATE jobs SET payload_json = '{}' WHERE id = ?").run(raceJob.id);
    db.exec(
      "DROP TRIGGER job_events_validate_insert; DROP TRIGGER job_events_validate_update;"
    );
    db.prepare("UPDATE job_events SET metadata_json = '{' WHERE job_id = ?").run(
      transitionJob.id
    );
    const invalidEvent = db
      .prepare("SELECT id FROM job_events WHERE job_id = ? LIMIT 1")
      .get(transitionJob.id) as { id: number };
    expect(() => migrate(db)).toThrow(`Invalid existing job event: ${invalidEvent.id}`);
  });
});
