export interface ParsedArgs {
  command: string;
  options: Record<string, string>;
}

interface CommandSpec {
  options: readonly string[];
  requiresDatabase: boolean;
}

const commandSpecs: Readonly<Record<string, CommandSpec>> = {
  help: { options: [], requiresDatabase: false },
  "init-db": { options: [], requiresDatabase: true },
  "open-login": { options: ["blog"], requiresDatabase: false },
  "register-blog": { options: ["blog"], requiresDatabase: true },
  "audit-drafts": { options: ["blog", "article"], requiresDatabase: false },
  "audit-published-post": { options: ["blog", "article"], requiresDatabase: false },
  "dry-run": { options: ["blog", "article"], requiresDatabase: true },
  "save-draft": { options: ["blog", "article"], requiresDatabase: true },
  "prepare-generation-package": { options: ["manifest", "output"], requiresDatabase: false },
  "import-generated-articles": {
    options: ["plan", "responses", "output"],
    requiresDatabase: false
  },
  "compile-generated-batch": {
    options: ["plan", "responses", "output"],
    requiresDatabase: false
  },
  "attach-batch-images": {
    options: ["manifest", "images", "output"],
    requiresDatabase: false
  },
  "attach-batch-sources": {
    options: ["manifest", "sources", "output"],
    requiresDatabase: false
  },
  "compile-content-batch": {
    options: ["plan", "responses", "images", "output"],
    requiresDatabase: false
  },
  "audit-content-batch": {
    options: ["manifest", "output"],
    requiresDatabase: false
  },
  "prepare-content-audit-retry": {
    options: ["manifest", "audit", "output"],
    requiresDatabase: false
  },
  "prepare-content-remediation-package": {
    options: ["manifest", "audit", "output"],
    requiresDatabase: false
  },
  "import-content-remediations": {
    options: ["manifest", "package", "responses", "output"],
    requiresDatabase: false
  },
  "update-draft-sources": {
    options: ["manifest"],
    requiresDatabase: false
  },
  "estimate-openai-generation": { options: ["package"], requiresDatabase: false },
  "generate-openai-articles": {
    options: ["package", "output", "confirm-max-cost-cents"],
    requiresDatabase: false
  },
  "prepare-article-queue": { options: ["manifest", "output"], requiresDatabase: false },
  "run-batch": { options: ["manifest"], requiresDatabase: true },
  "run-schedule-batch": { options: ["manifest"], requiresDatabase: true },
  "inspect-schedule-batch": { options: ["batch"], requiresDatabase: false },
  "list-schedule-batches": { options: [], requiresDatabase: false },
  "prepare-campaign": { options: ["manifest"], requiresDatabase: true },
  "validate-campaign": { options: ["manifest"], requiresDatabase: true },
  "inspect-campaign": { options: ["campaign"], requiresDatabase: true },
  "list-campaigns": { options: [], requiresDatabase: true },
  "plan-schedule": { options: ["blog", "article"], requiresDatabase: true },
  "approve-schedule": { options: ["job", "confirm"], requiresDatabase: true },
  "check-schedule": { options: ["job"], requiresDatabase: true },
  "cancel-schedule": { options: ["job", "confirm"], requiresDatabase: true },
  "preview-approved-schedule": { options: ["job"], requiresDatabase: true },
  "confirm-schedule-preview": {
    options: ["job", "confirm", "preview-sha"],
    requiresDatabase: true
  },
  "prepare-execution-package": {
    options: ["job", "confirm", "preview-confirmation-sha"],
    requiresDatabase: true
  },
  "audit-execution-package": {
    options: ["job", "package-sha"],
    requiresDatabase: true
  },
  "execute-schedule": {
    options: ["job", "confirm", "package-sha", "audit-sha"],
    requiresDatabase: true
  }
};

function getCommandSpec(command: string): CommandSpec {
  const spec = commandSpecs[command];
  if (!spec) {
    throw new Error(`Unknown command: ${command}`);
  }
  return spec;
}

export function commandRequiresDatabase(command: string): boolean {
  return getCommandSpec(command).requiresDatabase;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const allowedOptions = getCommandSpec(command).options;

  const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const key = token.slice(2);
    if (!allowedOptions.includes(key)) {
      throw new Error(`Unknown option --${key} for command ${command}`);
    }
    if (Object.hasOwn(options, key)) {
      throw new Error(`Duplicate option --${key}`);
    }

    const value = rest[index + 1];
    if (!value || value.startsWith("--") || value.trim().length === 0) {
      throw new Error(`Missing value for option --${key}`);
    }
    options[key] = value;
    index += 1;
  }

  for (const key of allowedOptions) {
    if (!Object.hasOwn(options, key)) {
      throw new Error(`Missing required option --${key}`);
    }
  }

  if (command === "execute-schedule") {
    if (options.confirm !== options.job) {
      throw new Error("Execution confirmation must exactly match the job ID");
    }
    for (const key of ["package-sha", "audit-sha"] as const) {
      if (!/^[a-f0-9]{64}$/.test(options[key])) {
        throw new Error(`Execution option --${key} must be a lowercase SHA-256`);
      }
    }
  }

  return { command, options };
}
