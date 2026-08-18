import { z } from "zod";

const safeHttpsUrlSchema = z
  .string()
  .url()
  .max(4096)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "Source URL must be credential-free HTTPS"
      });
    }
  });

const batchSourceAssignmentSchema = z
  .object({
    blogKey: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase ASCII words and hyphens"),
    generationRequestId: z.string().trim().min(1).max(100),
    sources: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(500),
            url: safeHttpsUrlSchema
          })
          .strict()
      )
      .min(1)
      .max(30)
  })
  .strict()
  .superRefine((assignment, context) => {
    const urls = assignment.sources.map((source) => new URL(source.url).href);
    if (new Set(urls).size !== urls.length) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Source URLs must be unique"
      });
    }
  });

export const batchSourceAssignmentsSchema = z
  .object({
    schemaVersion: z.literal(1),
    sectionHeading: z.string().trim().min(1).max(100).default("公式情報"),
    items: z.array(batchSourceAssignmentSchema).min(1).max(500)
  })
  .strict()
  .superRefine((manifest, context) => {
    const keys = new Set<string>();
    manifest.items.forEach((item, index) => {
      const key = `${item.blogKey}\0${item.slug}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["items", index],
          message: `Duplicate source assignment: ${item.blogKey}/${item.slug}`
        });
      }
      keys.add(key);
    });
  });

export type BatchSourceAssignments = z.infer<typeof batchSourceAssignmentsSchema>;
