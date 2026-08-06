import { blogConfigSchema, type BlogConfig } from "../config/blogConfig.js";
import { nowIso } from "../utils/time.js";
import type { SqliteDatabase } from "./database.js";

export class BlogRepository {
  constructor(private readonly db: SqliteDatabase) {}

  upsert(config: BlogConfig): void {
    const validated = blogConfigSchema.parse(config);
    const now = nowIso();
    this.db
      .prepare(
        `
        INSERT INTO blogs (blog_key, display_name, config_json, created_at, updated_at)
        VALUES (@blogKey, @displayName, @configJson, @now, @now)
        ON CONFLICT(blog_key) DO UPDATE SET
          display_name = excluded.display_name,
          config_json = excluded.config_json,
          updated_at = excluded.updated_at
      `
      )
      .run({
        blogKey: validated.blogKey,
        displayName: validated.displayName,
        configJson: JSON.stringify(validated),
        now
      });
  }

  findConfig(blogKey: string): BlogConfig | null {
    const row = this.db
      .prepare("SELECT config_json AS configJson FROM blogs WHERE blog_key = ?")
      .get(blogKey) as { configJson: string } | undefined;
    if (!row) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.configJson);
    } catch {
      throw new Error(`Invalid persisted blog config JSON for ${blogKey}`);
    }
    const result = blogConfigSchema.safeParse(parsed);
    if (!result.success || result.data.blogKey !== blogKey) {
      throw new Error(`Invalid persisted blog config for ${blogKey}`);
    }
    return result.data;
  }
}