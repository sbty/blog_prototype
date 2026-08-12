import { describe, expect, it } from "vitest";
import { ArticleQueueRoutingService } from "../services/articleQueueRoutingService.js";

function blog(blogKey: string, topicClusters: string[], excludedTopics: string[] = []) {
  return {
    blogKey,
    displayName: blogKey,
    adminUrl: `https://www.blogger.com/blog/posts/${
      blogKey === "compatibility" ? "1234567890123456789" : "9876543210987654321"
    }`,
    primaryTheme: `${blogKey} primary theme`,
    topicClusters,
    excludedTopics
  };
}

function article(slug: string, scheduledAt?: string) {
  return {
    title: `Article ${slug}`,
    html: `<p>${slug}</p>`,
    labels: [],
    searchDescription: `Description ${slug}`,
    slug,
    ...(scheduledAt ? { scheduledAt } : {})
  };
}

function queue(items: unknown[], targetOperation = "save-drafts") {
  return {
    targetOperation,
    blogs: [
      blog(
        "compatibility",
        ["USB-C and USB PD", "GPU compatibility"],
        ["unsafe electrical modifications"]
      ),
      blog(
        "troubleshooting",
        ["GPU temperature and utilization", "Windows game settings"],
        ["anti-cheat bypass"]
      )
    ],
    items
  };
}

describe("ArticleQueueRoutingService", () => {
  it("routes every item to the unique highest-scoring blog taxonomy", () => {
    const result = new ArticleQueueRoutingService().execute(
      queue([
        { article: article("usb-c"), routing: { topics: ["USB-C and USB PD"] } },
        {
          article: article("gpu-heat"),
          routing: { topics: ["GPU temperature and utilization"] }
        }
      ])
    );

    expect(result.manifest.items.map((item) => item.blogKey)).toEqual([
      "compatibility",
      "troubleshooting"
    ]);
    expect(result.assignments).toEqual([
      {
        slug: "usb-c",
        blogKey: "compatibility",
        mode: "topic",
        score: 1,
        matchedTopics: ["USB-C and USB PD"]
      },
      {
        slug: "gpu-heat",
        blogKey: "troubleshooting",
        mode: "topic",
        score: 1,
        matchedTopics: ["GPU temperature and utilization"]
      }
    ]);
  });

  it("preserves an explicit assignment after validating exclusions", () => {
    const result = new ArticleQueueRoutingService().execute(
      queue([
        {
          article: article("manual"),
          routing: { blogKey: "troubleshooting", topics: ["Windows game settings"] }
        }
      ])
    );

    expect(result.assignments[0]).toMatchObject({
      blogKey: "troubleshooting",
      mode: "explicit",
      score: null
    });
  });

  it("does not let duplicate normalized topics inflate a routing score", () => {
    const result = new ArticleQueueRoutingService().execute(
      queue([
        {
          article: article("deduplicated"),
          routing: { topics: ["USB-C and USB PD", "  usb-c AND usb pd  "] }
        }
      ])
    );

    expect(result.assignments[0]).toMatchObject({
      blogKey: "compatibility",
      score: 1,
      matchedTopics: ["USB-C and USB PD"]
    });
  });

  it("rejects an automatic routing tie instead of guessing", () => {
    expect(() =>
      new ArticleQueueRoutingService().execute(
        queue([{ article: article("gpu"), routing: { topics: ["GPU"] } }])
      )
    ).toThrow("ambiguous routing tie: compatibility, troubleshooting");
  });

  it("rejects unmatched and excluded topics", () => {
    expect(() =>
      new ArticleQueueRoutingService().execute(
        queue([{ article: article("coffee"), routing: { topics: ["coffee grinders"] } }])
      )
    ).toThrow("does not match any blog taxonomy");
    expect(() =>
      new ArticleQueueRoutingService().execute(
        queue([
          {
            article: article("unsafe"),
            routing: {
              blogKey: "compatibility",
              topics: ["unsafe electrical modifications"]
            }
          }
        ])
      )
    ).toThrow("conflicts with excluded topics for compatibility");
  });

  it("rejects duplicate slugs and unknown explicit blogs during queue validation", () => {
    expect(() =>
      new ArticleQueueRoutingService().execute(
        queue([
          { article: article("duplicate"), routing: { blogKey: "compatibility" } },
          { article: article("duplicate"), routing: { blogKey: "missing" } }
        ])
      )
    ).toThrow();
  });

  it("applies all existing batch safety validation before returning output", () => {
    expect(() =>
      new ArticleQueueRoutingService().execute(
        queue(
          [{ article: article("scheduled"), routing: { blogKey: "compatibility" } }],
          "plan-schedules"
        )
      )
    ).toThrow("Scheduled batch items require article.scheduledAt");
    expect(() =>
      new ArticleQueueRoutingService().execute(
        queue([{ article: article("preview"), routing: { blogKey: "compatibility" } }], "dry-run")
      )
    ).toThrow("Dry-run batches require an existing dedicated draft postEditorUrl");
  });
});
