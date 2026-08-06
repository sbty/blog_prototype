import type { ArticleInput } from "../domain/article.js";
import { nowIso } from "../utils/time.js";
import type { SqliteDatabase } from "./database.js";

export class ArticleRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: ArticleInput & { id: string; jobId: string; blogKey: string }): void {
    if (!Array.isArray(input.labels) || !input.labels.every((label) => typeof label === "string")) {
      throw new Error("Article labels must be an array of strings");
    }
    if (input.scheduledAt && !Number.isFinite(new Date(input.scheduledAt).getTime())) {
      throw new Error("Article scheduledAt must be a valid date-time");
    }
    const now = nowIso();
    this.db
      .prepare(
        `
        INSERT INTO articles (
          id, job_id, blog_key, title, slug, html, labels_json, search_description,
          scheduled_at, image_path, created_at, updated_at
        )
        VALUES (
          @id, @jobId, @blogKey, @title, @slug, @html, @labelsJson, @searchDescription,
          @scheduledAt, @imagePath, @now, @now
        )
      `
      )
      .run({
        id: input.id,
        jobId: input.jobId,
        blogKey: input.blogKey,
        title: input.title,
        slug: input.slug,
        html: input.html,
        labelsJson: JSON.stringify(input.labels),
        searchDescription: input.searchDescription,
        scheduledAt: input.scheduledAt ?? null,
        imagePath: input.imagePath ?? null,
        now
      });
  }
  countSchedulePlansForLocalDate(input: {
    localDate: string;
    timezone: string;
    blogKey?: string;
  }): number {
    const rows = this.db
      .prepare(
        `
        SELECT a.blog_key AS blogKey, a.scheduled_at AS scheduledAt
        FROM articles a
        INNER JOIN jobs j ON j.id = a.job_id
        WHERE j.mode = 'schedule'
          AND j.status IN ('PENDING', 'RUNNING', 'READY_FOR_POST', 'APPROVED_FOR_POST', 'PREVIEW_CONFIRMED')
          AND a.scheduled_at IS NOT NULL
        `
      )
      .all() as Array<{ blogKey: string; scheduledAt: string }>;
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: input.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return rows.filter((row) => {
      if (input.blogKey && row.blogKey !== input.blogKey) return false;
      const date = new Date(row.scheduledAt);
      if (!Number.isFinite(date.getTime())) return false;
      return formatter.format(date) === input.localDate;
    }).length;
  }
  findScheduleByJobId(jobId: string): { blogKey: string; scheduledAt: string } | null {
    const row = this.db
      .prepare(
        `
        SELECT blog_key AS blogKey, scheduled_at AS scheduledAt
        FROM articles
        WHERE job_id = ? AND scheduled_at IS NOT NULL
        `
      )
      .get(jobId) as { blogKey: string; scheduledAt: string } | undefined;
    if (row && !Number.isFinite(new Date(row.scheduledAt).getTime())) {
      throw new Error(`Invalid persisted article scheduledAt for job ${jobId}`);
    }
    return row ?? null;
  }
}
