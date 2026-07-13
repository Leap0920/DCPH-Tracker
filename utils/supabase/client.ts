import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Call this inside Client Components (chat window, status toggles, etc.)
export const createClient = () =>
  createBrowserClient<Database>(supabaseUrl, supabaseKey);
