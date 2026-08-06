import pino from "pino";
import type { AppConfig } from "../config/env.js";

const sensitiveLogPaths = [
  "OPENAI_API_KEY",
  "*.OPENAI_API_KEY",
  "apiKey",
  "*.apiKey",
  "password",
  "*.password",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "clientSecret",
  "*.clientSecret",
  "cookie",
  "*.cookie",
  "Cookie",
  "*.Cookie",
  "authorization",
  "*.authorization",
  "Authorization",
  "*.Authorization"
];

export function createLogger(
  config: Pick<AppConfig, "LOG_LEVEL">,
  destination?: pino.DestinationStream
) {
  const options = {
    level: config.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: sensitiveLogPaths
  };
  return destination ? pino(options, destination) : pino(options);
}