import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Supabase only backs the optional `quote` builtin. `createClient` throws when
 * the credentials are missing, and this module is reachable from the terminal's
 * builtin commands, so an unconfigured build (no `.env`) would fail to boot at
 * all rather than simply losing quotes. Skip the client instead and let
 * `getRandomQuote` report it like any other lookup failure.
 */
export const supabase =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey)
    : null;

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
    if (!supabase) {
      throw new Error(
        "Quotes are unavailable: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY were not set when this build was made."
      );
    }

    const { data, error } = await supabase.rpc("get_random_quote");

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