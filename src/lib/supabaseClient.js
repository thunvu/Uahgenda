import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export async function signInWithGoogle() {
  if (!supabase) {
    throw new Error("Supabase chưa được cấu hình. Hãy tạo file .env từ .env.example.");
  }

  const redirectTo = `${window.location.origin}/`;
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: "openid email profile https://www.googleapis.com/auth/calendar.app.created",
      queryParams: {
        access_type: "offline",
        prompt: "consent"
      }
    }
  });
}

export async function signOut() {
  if (!supabase) return;
  return supabase.auth.signOut();
}

export async function persistGoogleConnection(session) {
  if (!supabase || !session?.provider_token) return;

  return supabase.functions.invoke("save-google-connection", {
    body: {
      providerToken: session.provider_token,
      providerRefreshToken: session.provider_refresh_token,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      scopes: session.scopes
    }
  });
}
