import type { Config } from "drizzle-kit";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is required to run drizzle-kit");
}

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config;
