import { z } from "zod";

const bloggerHttpsUrlSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Blogger URL must use HTTPS" });
  }
  if (url.hostname !== "www.blogger.com" && url.hostname !== "blogger.com") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Blogger URL must use the official blogger.com host"
    });
  }
  if (url.username || url.password) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Blogger URL must not contain credentials"
    });
  }
});

export const blogConfigSchema = z.object({
  blogKey: z.string().min(1),
  displayName: z.string().min(1),
  adminUrl: bloggerHttpsUrlSchema,
  publicUrl: z.string().url().optional(),
  language: z.string().default("ja"),
  targetCountry: z.string().default("JP"),
  primaryTheme: z.string().min(1),
  targetAudience: z.array(z.string()).default([]),
  topicClusters: z.array(z.string()).default([]),
  excludedTopics: z.array(z.string()).default([]),
  contentPolicy: z
    .object({
      evergreenRatio: z.number().min(0).max(1).default(0.55),
      durableExplainerRatio: z.number().min(0).max(1).default(0.25),
      seasonalRatio: z.number().min(0).max(1).default(0.1),
      newsRatio: z.number().min(0).max(1).default(0.1)
    })
    .default({}),
  targetLength: z
    .object({
      min: z.number().int().positive().default(3000),
      max: z.number().int().positive().default(5000)
    })
    .default({}),
  dailyPostLimit: z.number().int().positive().default(1),
  blogger: z
    .object({
      selectorsPath: z.string().default("./config/blogger-selectors.json"),
      postEditorUrl: bloggerHttpsUrlSchema.optional()
    })
    .default({})
}).superRefine((config, context) => {
  if (config.targetLength.min > config.targetLength.max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetLength", "min"],
      message: "targetLength.min must be less than or equal to targetLength.max"
    });
  }
  const ratioTotal =
    config.contentPolicy.evergreenRatio +
    config.contentPolicy.durableExplainerRatio +
    config.contentPolicy.seasonalRatio +
    config.contentPolicy.newsRatio;
  if (Math.abs(ratioTotal - 1) > 1e-9) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentPolicy"],
      message: "contentPolicy ratios must total 1"
    });
  }
});

export type BlogConfig = z.infer<typeof blogConfigSchema>;
