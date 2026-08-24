import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey
);

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