import { z } from "zod";

export const articleInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    html: z
      .string()
      .max(2_000_000)
      .refine((value) => value.trim().length > 0, "Article HTML must not be empty")
      .refine(
        (value) =>
          !/<\s*\/?\s*(script|object|embed|form)\b/i.test(value) &&
          !/\son[a-z]+\s*=/i.test(value) &&
          !/javascript\s*:/i.test(value),
        "Article HTML contains active content"
      ),
    labels: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    searchDescription: z.string().trim().min(1).max(500),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must use lowercase ASCII words and hyphens"),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    imagePath: z.string().trim().min(1).max(4096).optional()
  })
  .strict();

export type ArticleInput = z.infer<typeof articleInputSchema>;