import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userResult, error: userError } = await authClient.auth.getUser();

  if (userError || !userResult.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const body = await req.json();
  const accessToken = body.providerToken;
  const refreshToken = body.providerRefreshToken;

  if (!accessToken && !refreshToken) {
    return jsonResponse({ error: "No Google token found in session" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
  const scopes = typeof body.scopes === "string" ? body.scopes.split(" ") : [];

  const { error } = await serviceClient
    .from("google_connections")
    .upsert({
      user_id: userResult.user.id,
      google_email: userResult.user.email,
      access_token: accessToken || null,
      refresh_token: refreshToken || undefined,
      expires_at: expiresAt,
      scopes
    }, { onConflict: "user_id" });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ ok: true });
});
