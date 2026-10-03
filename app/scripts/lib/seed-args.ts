import { z } from "zod";

// There is no `prod` target and no `--confirm-production` flag: one database, one guard (ruling H35). The image modes
// are `upload` and `skip` (ruling H33).
const argsSchema = z.object({
  target: z.enum(["dev", "local"]),
  mode: z.enum(["full", "reference"]),
  images: z.enum(["upload", "skip"]),
});

export type SeedArgs = z.infer<typeof argsSchema>;

const DEFAULTS: SeedArgs = { target: "dev", mode: "full", images: "skip" };

function invalid(reason: string): Error {
  return new Error(`seed: invalid arguments ${reason}`);
}

/**
 * `--target dev|local`, `--mode full|reference`, `--images upload|skip`, in pairs, a leading `--` ignored so that
 * `bun run seed -- --target dev` works. Anything else throws before any connection is opened.
 */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const pairs = argv[0] === "--" ? argv.slice(1) : argv;
  const picked: Record<string, string> = {};
  for (let index = 0; index < pairs.length; index += 2) {
    const flag = pairs[index] ?? "";
    const name = flag.slice(2);
    if (!flag.startsWith("--") || !Object.hasOwn(argsSchema.shape, name)) {
      throw invalid(`unknown option ${flag}`);
    }
    picked[name] = pairs[index + 1] ?? "";
  }
  const parsed = argsSchema.safeParse({ ...DEFAULTS, ...picked });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalid(`--${String(issue?.path[0])}: ${issue?.message ?? "not accepted"}`);
  }
  return parsed.data;
}

/** The `--target local` stack is B4's ephemeral one: its API must be on this machine (T-01). */
export function localApiUrl(apiUrl: string | undefined): string {
  if (apiUrl === undefined || !URL.canParse(apiUrl) || new URL(apiUrl).hostname !== "127.0.0.1") {
    throw invalid("local target must be 127.0.0.1");
  }
  return apiUrl;
}
