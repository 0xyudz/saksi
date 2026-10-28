import { config } from "dotenv";

// Next.js gives `.env.local` precedence over `.env`; scripts must load the same pair so
// a verification run cannot silently use different credentials from the app.
config({ path: [".env.local", ".env"], quiet: true });
