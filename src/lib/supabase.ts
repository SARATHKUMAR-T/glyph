import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

// Lazily initialized so that missing env vars don't throw at module load time
// and crash the entire app (which would cause a blank screen in production).
let _supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    if (!supabaseUrl || !supabasePublishableKey) {
      throw new Error(
        "Supabase env vars (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY) are not set."
      );
    }
    _supabase = createClient(supabaseUrl, supabasePublishableKey);
  }
  return _supabase;
}

export function formatErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (typeof err.message === "string") return err.message;
    if (typeof err.error_description === "string") return err.error_description;
    if (typeof err.details === "string" && err.details) return err.details;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export async function getRandomQuote(): Promise<{ quote: string; author: string }> {
  try {
    const { data, error } = await getSupabaseClient().rpc("get_random_quote");

    if (error) {
      throw new Error(formatErrorMessage(error));
    }

    if (!data || data.length === 0) {
      throw new Error("No quotes found");
    }

    return data[0];
  } catch (err: unknown) {
    throw new Error(formatErrorMessage(err));
  }
}