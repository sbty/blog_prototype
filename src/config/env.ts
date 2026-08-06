import "dotenv/config";
import { z } from "zod";

const trueBooleanValues = ["1", "true", "yes", "on"];
const falseBooleanValues = ["0", "false", "no", "off"];

function boolFromString(defaultValue: "true" | "false" = "false") {
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (value) => [...trueBooleanValues, ...falseBooleanValues].includes(value),
      "Expected a boolean value (true/false, 1/0, yes/no, on/off)"
    )
    .optional()
    .default(defaultValue)
    .transform((value) => trueBooleanValues.includes(value));
}

function intFromString(defaultValue: string) {
  return z
    .string()
    .regex(/^[1-9]\d*$/, "Expected a positive integer")
    .optional()
    .default(defaultValue)
    .transform((value) => Number(value));
}

function numberFromString(defaultValue: string, min: number, max: number) {
  return z
    .string()
    .optional()
    .default(defaultValue)
    .transform((value) => Number(value))
    .pipe(z.number().finite().min(min).max(max));
}

const timezoneSchema = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  },
  { message: "Expected a valid IANA timezone" }
);

const localPathSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected a non-empty path")
  .refine((value) => !value.includes("\0"), "Path must not contain a NUL character");
const optionalBloggerBlogIdSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{10,30}$/.test(value), {
    message: "Expected an empty value or a numeric Blogger blog ID"
  });

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_PATH: localPathSchema.default("./data/app.sqlite"),
  DATA_DIR: localPathSchema.default("./data"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_TEXT_MODEL: z.string().optional().default(""),
  OPENAI_IMAGE_MODEL: z.string().optional().default(""),
  CHROME_CHANNEL: z.string().optional().default("chrome"),
  CHROME_EXECUTABLE_PATH: z.string().optional().default(""),
  CHROME_PROFILE_PATH: z.string().optional().default(""),
  HEADLESS: boolFromString("false"),
  APP_TIMEZONE: timezoneSchema.default("Asia/Tokyo"),
  AUTHORIZED_TEST_BLOG_ID: optionalBloggerBlogIdSchema.optional().default(""),
  ENABLE_AUTO_TOPIC_SELECTION: boolFromString("false"),
  ENABLE_ARTICLE_GENERATION: boolFromString("true"),
  ENABLE_IMAGE_GENERATION: boolFromString("true"),
  ENABLE_DRY_RUN: boolFromString("true"),
  ENABLE_DRAFT_SAVE: boolFromString("false"),
  ENABLE_SCHEDULED_POST: boolFromString("false"),
  SYSTEM_DAILY_POST_LIMIT: intFromString("3"),
  PER_BLOG_DAILY_POST_LIMIT: intFromString("1"),
  MAX_CONSECUTIVE_FAILURES: intFromString("3"),
  MIN_LONG_TERM_VALUE_SCORE: numberFromString("65", 0, 100),
  MIN_JAPANESE_CONTENT_GAP_SCORE: numberFromString("70", 0, 100),
  MIN_JAPAN_RELEVANCE_SCORE: numberFromString("50", 0, 100),
  MIN_OPPORTUNITY_SCORE: numberFromString("70", 0, 100),
  MIN_CONFIDENCE: numberFromString("0.65", 0, 1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
