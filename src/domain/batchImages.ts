import { z } from "zod";

const batchImageAssignmentSchema = z
  .object({
    blogKey: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase ASCII words and hyphens"),
    imagePath: z.string().trim().min(1).max(4096)
  })
  .strict();

export const batchImageAssignmentsSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(batchImageAssignmentSchema).min(1).max(500)
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
          message: `Duplicate image assignment: ${item.blogKey}/${item.slug}`
        });
      }
      keys.add(key);
    });
  });

export type BatchImageAssignments = z.infer<typeof batchImageAssignmentsSchema>;
