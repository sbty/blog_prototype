import type { BlogConfig } from "../config/blogConfig.js";
import { articleQueueManifestSchema, type ArticleQueueManifest } from "../domain/articleQueue.js";
import { batchManifestSchema, type BatchManifest } from "../domain/batch.js";

export interface ArticleQueueAssignment {
  slug: string;
  blogKey: string;
  mode: "explicit" | "topic";
  score: number | null;
  matchedTopics: string[];
}

export interface ArticleQueueRoutingResult {
  manifest: BatchManifest;
  assignments: ArticleQueueAssignment[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("und").replace(/\s+/g, " ");
}

function related(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function scoreBlog(blog: BlogConfig, topics: string[]): { score: number; matchedTopics: string[] } {
  const uniqueTopics = topics.filter(
    (topic, index) =>
      topics.findIndex((candidate) => normalize(candidate) === normalize(topic)) === index
  );
  if (
    uniqueTopics.some((topic) => blog.excludedTopics.some((excluded) => related(topic, excluded)))
  ) {
    return { score: -1, matchedTopics: [] };
  }

  const taxonomy = [blog.primaryTheme, ...blog.topicClusters];
  const matchedTopics = uniqueTopics.filter((topic) =>
    taxonomy.some((entry) => related(topic, entry))
  );
  return { score: matchedTopics.length, matchedTopics };
}

export class ArticleQueueRoutingService {
  execute(input: unknown): ArticleQueueRoutingResult {
    const queue = articleQueueManifestSchema.parse(input);
    const assignments = queue.items.map((item) => this.assign(queue, item));
    const manifest = batchManifestSchema.parse({
      operation: queue.targetOperation,
      continueOnError: queue.continueOnError,
      blogs: queue.blogs,
      items: queue.items.map((item, index) => ({
        blogKey: assignments[index].blogKey,
        article: item.article,
        ...(item.provenance ? { provenance: item.provenance } : {})
      }))
    });

    return { manifest, assignments };
  }

  private assign(
    queue: ArticleQueueManifest,
    item: ArticleQueueManifest["items"][number]
  ): ArticleQueueAssignment {
    if (item.routing.blogKey) {
      const blog = queue.blogs.find((candidate) => candidate.blogKey === item.routing.blogKey);
      if (!blog) throw new Error(`Unknown blogKey: ${item.routing.blogKey}`);
      const scored = scoreBlog(blog, item.routing.topics);
      if (scored.score < 0) {
        throw new Error(
          `Queue item ${item.article.slug} conflicts with excluded topics for ${blog.blogKey}`
        );
      }
      return {
        slug: item.article.slug,
        blogKey: blog.blogKey,
        mode: "explicit",
        score: null,
        matchedTopics: scored.matchedTopics
      };
    }

    const candidates = queue.blogs
      .map((blog) => ({ blog, ...scoreBlog(blog, item.routing.topics) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.blog.blogKey < right.blog.blogKey
          ? -1
          : left.blog.blogKey > right.blog.blogKey
            ? 1
            : 0;
      });
    const best = candidates[0];
    if (!best) {
      throw new Error(`Queue item ${item.article.slug} does not match any blog taxonomy`);
    }
    const tied = candidates.filter((candidate) => candidate.score === best.score);
    if (tied.length > 1) {
      throw new Error(
        `Queue item ${item.article.slug} has an ambiguous routing tie: ${tied
          .map((candidate) => candidate.blog.blogKey)
          .join(", ")}`
      );
    }

    return {
      slug: item.article.slug,
      blogKey: best.blog.blogKey,
      mode: "topic",
      score: best.score,
      matchedTopics: best.matchedTopics
    };
  }
}
