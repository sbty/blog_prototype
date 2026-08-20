import { z } from "zod";
import { articleInputSchema } from "../domain/article.js";
import { batchManifestSchema, type BatchManifest } from "../domain/batch.js";
import {
  contentRemediationPackageSchema,
  type ContentRemediationPackage
} from "./contentRemediationPackageService.js";

const remediationArticleSchema = articleInputSchema.pick({
  title: true,
  html: true,
  labels: true,
  searchDescription: true,
  slug: true
});

const sourceUrlSchema = z
  .string()
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Remediation source URL must be credential-free HTTPS");

function normalizedUrlSet(urls: string[]): Set<string> {
  return new Set(urls.map((url) => new URL(url).href));
}

function normalizedUrlsMatch(expected: string[], actual: string[]): boolean {
  const expectedSet = normalizedUrlSet(expected);
  const actualSet = normalizedUrlSet(actual);
  return (
    expectedSet.size === actualSet.size &&
    [...expectedSet].every((sourceUrl) => actualSet.has(sourceUrl))
  );
}

export const contentRemediationResponsesSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z
      .array(
        z
          .object({
            remediationId: z
              .string()
              .regex(/^content-remediation-\d{4}$/)
              .max(100),
            article: remediationArticleSchema,
            sourceUrlsUsed: z.array(sourceUrlSchema).min(1).max(30)
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict()
  .superRefine((responses, context) => {
    const ids = new Set<string>();
    responses.items.forEach((item, index) => {
      if (ids.has(item.remediationId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "remediationId"],
          message: `Duplicate remediationId: ${item.remediationId}`
        });
      }
      ids.add(item.remediationId);
      if (normalizedUrlSet(item.sourceUrlsUsed).size !== item.sourceUrlsUsed.length) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "sourceUrlsUsed"],
          message: "Remediation source URLs must be unique"
        });
      }
    });
  });

export type ContentRemediationResponses = z.infer<typeof contentRemediationResponsesSchema>;

export interface ContentRemediationImportResult {
  manifest: BatchManifest;
  importedAssignments: Array<{
    remediationId: string;
    sourceIndex: number;
    blogKey: string;
    slug: string;
  }>;
}

function assertRequestMatchesSource(
  remediationPackage: ContentRemediationPackage,
  batch: BatchManifest
): void {
  remediationPackage.requests.forEach((request) => {
    const source = batch.items[request.sourceIndex];
    if (!source) {
      throw new Error(
        `Content remediation ${request.remediationId} references missing source index ${request.sourceIndex}`
      );
    }
    const currentArticle = {
      title: source.article.title,
      html: source.article.html,
      labels: source.article.labels,
      searchDescription: source.article.searchDescription,
      slug: source.article.slug
    };
    const blog = batch.blogs.find((candidate) => candidate.blogKey === source.blogKey)!;
    const editorialProfile = {
      displayName: blog.displayName,
      language: blog.language,
      targetCountry: blog.targetCountry,
      primaryTheme: blog.primaryTheme,
      targetAudience: blog.targetAudience,
      topicClusters: blog.topicClusters,
      excludedTopics: blog.excludedTopics,
      targetLength: blog.targetLength
    };
    const sourceUrls = source.provenance?.sourceUrls ?? [];
    if (
      source.blogKey !== request.blogKey ||
      JSON.stringify(currentArticle) !== JSON.stringify(request.currentArticle) ||
      JSON.stringify(editorialProfile) !== JSON.stringify(request.editorialProfile) ||
      !normalizedUrlsMatch(sourceUrls, request.provenance.sourceUrls)
    ) {
      throw new Error(
        `Content remediation ${request.remediationId} does not match the current source batch`
      );
    }
  });
}

export class ContentRemediationImportService {
  execute(
    batchInput: unknown,
    packageInput: unknown,
    responsesInput: unknown
  ): ContentRemediationImportResult {
    const batch = batchManifestSchema.parse(batchInput);
    const remediationPackage = contentRemediationPackageSchema.parse(packageInput);
    const responses = contentRemediationResponsesSchema.parse(responsesInput);
    if (batch.operation !== "save-drafts") {
      throw new Error("Content remediation import requires a save-drafts batch");
    }
    assertRequestMatchesSource(remediationPackage, batch);

    const requestsById = new Map(
      remediationPackage.requests.map((request) => [request.remediationId, request])
    );
    const responsesById = new Map(
      responses.items.map((response) => [response.remediationId, response])
    );
    const unknownIds = responses.items
      .map((response) => response.remediationId)
      .filter((remediationId) => !requestsById.has(remediationId));
    if (unknownIds.length > 0) {
      throw new Error(`Remediation responses contain unknown IDs: ${unknownIds.join(", ")}`);
    }

    const correctedItems = remediationPackage.requests.map((request) => {
      const response = responsesById.get(request.remediationId);
      if (!response) {
        throw new Error(`Missing remediation response for ${request.remediationId}`);
      }
      if (response.article.slug !== request.currentArticle.slug) {
        throw new Error(`Remediation response ${request.remediationId} changed the source slug`);
      }
      if (
        request.provenance.sourceUrls.length > 0 &&
        !normalizedUrlsMatch(request.provenance.sourceUrls, response.sourceUrlsUsed)
      ) {
        throw new Error(
          `Remediation response ${request.remediationId} must attest to every provided source URL`
        );
      }

      const source = batch.items[request.sourceIndex];
      return {
        blogKey: source.blogKey,
        article: {
          ...response.article,
          ...(source.article.imagePath === undefined
            ? {}
            : { imagePath: source.article.imagePath }),
          ...(source.article.scheduledAt === undefined
            ? {}
            : { scheduledAt: source.article.scheduledAt })
        },
        provenance: {
          generationRequestId: source.provenance?.generationRequestId ?? request.remediationId,
          sourceUrls: response.sourceUrlsUsed
        }
      };
    });
    const includedBlogKeys = new Set(correctedItems.map((item) => item.blogKey));
    const manifest = batchManifestSchema.parse({
      ...batch,
      blogs: batch.blogs.filter((blog) => includedBlogKeys.has(blog.blogKey)),
      items: correctedItems
    });

    return {
      manifest,
      importedAssignments: remediationPackage.requests.map((request) => ({
        remediationId: request.remediationId,
        sourceIndex: request.sourceIndex,
        blogKey: request.blogKey,
        slug: request.currentArticle.slug
      }))
    };
  }
}
