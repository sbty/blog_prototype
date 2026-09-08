import { describe, expect, it, vi } from "vitest";
import { BatchImageAttachmentService } from "../services/batchImageAttachmentService.js";
import { BatchSourceAttachmentService } from "../services/batchSourceAttachmentService.js";
import { ArticleGenerationPackageService } from "../services/articleGenerationPackageService.js";
import { ContentBatchCompilerService } from "../services/contentBatchCompilerService.js";
import { GeneratedArticleBatchCompilerService } from "../services/generatedArticleBatchCompilerService.js";
import { loadConfig } from "../config/env.js";
import { generatedArticleResponsesSchema } from "../domain/articleGeneration.js";
import { VerifiedDraftPipelineService } from "../services/verifiedDraftPipelineService.js";

const estimate = {
  model: "gpt-5.6-luna" as const,
  requestCount: 1,
  inputBytes: 100,
  maxOutputTokens: 2_000,
  maximumCostCents: 3,
  pricingSafetyMultiplier: 5 as const
};

const usage = {
  inputTokens: 100,
  cachedInputTokens: 50,
  outputTokens: 200,
  reasoningTokens: 20,
  totalTokens: 300,
  usageBasedCostUsd: 0.01,
  usageBasedCostCents: 1,
  pricing: { inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 2 }
};

function plan(overrides: Record<string, unknown> = {}) {
  return {
    targetOperation: "save-drafts",
    blogs: [
      {
        blogKey: "compatibility",
        displayName: "Compatibility",
        adminUrl: "https://www.blogger.com/blog/posts/1234567890123456789",
        publicUrl: "https://private-blog.example.invalid/",
        language: "en",
        targetCountry: "US",
        primaryTheme: "Device compatibility",
        targetAudience: ["Buyers"],
        topicClusters: ["USB-C and USB PD"],
        excludedTopics: ["unsafe electrical modifications"],
        targetLength: { min: 1_800, max: 3_500 },
        blogger: { selectorsPath: "./private-selectors.json" }
      }
    ],
    requests: [
      {
        requestId: "request-one",
        blogKey: "compatibility",
        slug: "usb-c-compatibility",
        topic: "USB-C compatibility",
        searchIntent: "Check compatibility before purchase",
        routingTopics: ["USB-C and USB PD"],
        requiredPoints: ["Explain power negotiation"],
        sourceUrls: ["https://example.com/source-a", "https://example.org/source-b"]
      }
    ],
    ...overrides
  };
}

const responses = generatedArticleResponsesSchema.parse({
  schemaVersion: 1,
  items: [
    {
      requestId: "request-one",
      article: {
        title: "USB-C compatibility",
        html: "<article><p>Check the official specifications.</p></article>",
        labels: ["USB-C"],
        searchDescription: "How to check USB-C compatibility.",
        slug: "usb-c-compatibility"
      },
      sourceUrlsUsed: ["https://example.org/source-b", "https://example.com/source-a"]
    }
  ]
});

const images = {
  schemaVersion: 1,
  items: [
    {
      blogKey: "compatibility",
      slug: "usb-c-compatibility",
      imagePath: "C:/private/usb-c.png"
    }
  ]
};

const sources = {
  schemaVersion: 1,
  sectionHeading: "Official sources",
  items: [
    {
      blogKey: "compatibility",
      slug: "usb-c-compatibility",
      generationRequestId: "request-one",
      sources: [
        { title: "Source A", url: "https://example.com/source-a" },
        { title: "Source B", url: "https://example.org/source-b" }
      ]
    }
  ]
};

function fixture(input: { batchSucceeded?: boolean } = {}) {
  const config = loadConfig({
    DATA_DIR: "C:/private/data",
    DATABASE_PATH: "C:/private/data/app.sqlite",
    ENABLE_ARTICLE_GENERATION: "true",
    OPENAI_API_KEY: "test-key",
    ENABLE_DRY_RUN: "false",
    ENABLE_DRAFT_SAVE: "true",
    ENABLE_EXISTING_DRAFT_UPDATE: "false",
    ENABLE_SCHEDULED_POST: "false",
    AUTHORIZED_BLOG_IDS: "1234567890123456789"
  });
  const validateImage = vi.fn(async () => ({
    absolutePath: "C:/private/usb-c.png",
    extension: ".png",
    sizeBytes: 1_024
  }));
  const compiler = new ContentBatchCompilerService(
    new GeneratedArticleBatchCompilerService(),
    new BatchImageAttachmentService(validateImage),
    new BatchSourceAttachmentService()
  );
  const generationPackage = new ArticleGenerationPackageService().execute(plan()).package;
  const articleGenerator = {
    estimate: vi.fn(() => ({ package: generationPackage, estimate })),
    execute: vi.fn(async () => ({
      responses,
      estimate,
      responseId: "resp-1",
      usage
    }))
  };
  const succeeded = input.batchSucceeded ?? true;
  const batchExecutor = {
    execute: vi.fn(async () => ({
      batchId: "batch-1",
      operation: "save-drafts" as const,
      artifactDir: "C:/private/data/jobs/batch-1",
      reportPath: "C:/private/data/jobs/batch-1/batch-result.json",
      startedAt: "2026-09-08T00:00:00.000Z",
      completedAt: "2026-09-08T00:01:00.000Z",
      counts: {
        total: 1,
        succeeded: succeeded ? 1 : 0,
        failed: succeeded ? 0 : 1,
        skipped: 0
      },
      items: [
        {
          index: 0,
          blogKey: "compatibility",
          slug: "usb-c-compatibility",
          title: "USB-C compatibility",
          status: succeeded ? ("SUCCEEDED" as const) : ("FAILED" as const),
          ...(succeeded
            ? { jobId: "draft-1", artifactDir: "C:/private/data/jobs/draft-1" }
            : { error: "draft persistence audit failed" })
        }
      ]
    }))
  };
  const artifactWriter = {
    write: vi.fn<(name: string, value: unknown) => Promise<void>>(async () => undefined)
  };
  const service = new VerifiedDraftPipelineService(config, {
    batchExecutor,
    articleGenerator,
    contentCompiler: compiler,
    artifactWriter,
    validateImage
  });
  return { service, articleGenerator, batchExecutor, artifactWriter, validateImage };
}

describe("VerifiedDraftPipelineService", () => {
  it("generates, compiles, saves, and reports one verified new draft", async () => {
    const { service, articleGenerator, batchExecutor, artifactWriter, validateImage } = fixture();

    const result = await service.execute({
      plan: plan(),
      images,
      sources,
      confirmedMaximumCostCents: 3,
      confirmedDraftSaveRequestId: "request-one"
    });

    expect(result).toMatchObject({
      status: "PASS",
      requestId: "request-one",
      blogKey: "compatibility",
      execution: { counts: { succeeded: 1 }, item: { jobId: "draft-1" } }
    });
    expect(validateImage).toHaveBeenCalledTimes(2);
    expect(articleGenerator.execute).toHaveBeenCalledTimes(1);
    expect(validateImage.mock.invocationCallOrder[0]).toBeLessThan(
      articleGenerator.execute.mock.invocationCallOrder[0]
    );
    expect(batchExecutor.execute).toHaveBeenCalledTimes(1);
    expect(artifactWriter.write.mock.calls.map(([name]) => name)).toEqual([
      "generation-preflight",
      "generated-responses",
      "generation-usage",
      "content-batch",
      "pipeline-summary"
    ]);
  });

  it("rejects a target confirmation mismatch before paid generation", async () => {
    const { service, articleGenerator, batchExecutor, validateImage } = fixture();

    await expect(
      service.execute({
        plan: plan(),
        images,
        sources,
        confirmedMaximumCostCents: 3,
        confirmedDraftSaveRequestId: "different-request"
      })
    ).rejects.toThrow("must exactly match request-one");

    expect(validateImage).not.toHaveBeenCalled();
    expect(articleGenerator.execute).not.toHaveBeenCalled();
    expect(batchExecutor.execute).not.toHaveBeenCalled();
  });

  it("returns FAIL when draft persistence does not succeed", async () => {
    const { service, artifactWriter } = fixture({ batchSucceeded: false });

    const result = await service.execute({
      plan: plan(),
      images,
      sources,
      confirmedMaximumCostCents: 3,
      confirmedDraftSaveRequestId: "request-one"
    });

    expect(result).toMatchObject({
      status: "FAIL",
      execution: {
        counts: { failed: 1 },
        item: { status: "FAILED", error: "draft persistence audit failed" }
      }
    });
    expect(artifactWriter.write).toHaveBeenLastCalledWith("pipeline-summary", result);
  });
});
