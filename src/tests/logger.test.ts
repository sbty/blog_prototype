import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";

describe("createLogger", () => {
  it("redacts credentials and authentication headers", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      }
    });
    const logger = createLogger({ LOG_LEVEL: "info" }, destination);

    logger.info({
      OPENAI_API_KEY: "top-secret",
      Authorization: "Bearer top-upper-secret",
      Cookie: "top-upper-cookie",
      credentials: {
        password: "password-secret",
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        clientSecret: "client-secret"
      },
      headers: {
        authorization: "Bearer lower-secret",
        Authorization: "Bearer upper-secret",
        cookie: "lower-cookie",
        Cookie: "upper-cookie"
      },
      safe: "visible"
    });

    expect(output).toContain('"safe":"visible"');
    expect(output).toContain("[Redacted]");
    for (const secret of [
      "top-secret",
      "top-upper-secret",
      "top-upper-cookie",
      "password-secret",
      "access-secret",
      "refresh-secret",
      "client-secret",
      "lower-secret",
      "upper-secret",
      "lower-cookie",
      "upper-cookie"
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});