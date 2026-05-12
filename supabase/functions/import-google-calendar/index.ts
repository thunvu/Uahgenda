import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

type ScheduleEvent = {
  id: string;
  summary: string;
  starts_on: string;
  start_time: string;
  end_time: string;
  room: string | null;
  address: string | null;
  recurrence_rule: string;
};

function googleDateTime(date: string, time: string) {
  return `${date}T${time.slice(0, 8)}+07:00`;
}

function normalizeRecurrenceRule(rule: string) {
  return rule.replace(/UNTIL=(\d{8}T\d{6})(?!Z)/, "UNTIL=$1Z");
}

function buildGoogleEvent(event: ScheduleEvent) {
  return {
    summary: event.summary,
    location: [event.room, event.address].filter(Boolean).join(" - "),
    start: {
      dateTime: googleDateTime(event.starts_on, event.start_time),
      timeZone: "Asia/Ho_Chi_Minh",
    },
    end: {
      dateTime: googleDateTime(event.starts_on, event.end_time),
      timeZone: "Asia/Ho_Chi_Minh",
    },
    recurrence: [`RRULE:${normalizeRecurrenceRule(event.recurrence_rule)}`],
    extendedProperties: {
      private: {
        uahgendaEventId: event.id,
      },
    },
  };
}

function isValidEvent(event: unknown): event is ScheduleEvent {
  if (!event || typeof event !== "object") return false;
  const nextEvent = event as Partial<ScheduleEvent>;

  return [
    nextEvent.id,
    nextEvent.summary,
    nextEvent.starts_on,
    nextEvent.start_time,
    nextEvent.end_time,
    nextEvent.recurrence_rule,
  ].every((value) => typeof value === "string" && value.length > 0);
}

async function createGoogleCalendar(accessToken: string, calendarName: string) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: calendarName || "Thời khóa biểu UAH",
      timeZone: "Asia/Ho_Chi_Minh",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || "Google Calendar create failed");
  }

  if (!data.id) {
    throw new Error("Google Calendar response is missing calendar id");
  }

  return data.id as string;
}

async function refreshGoogleToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth client secrets");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Cannot refresh Google token");
  }

  return {
    accessToken: data.access_token as string,
    expiresAt: new Date(Date.now() + Number(data.expires_in || 3600) * 1000)
      .toISOString(),
  };
}

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
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userResult, error: userError } = await authClient.auth.getUser();

  if (userError || !userResult.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { calendarName = "Thời khóa biểu UAH", events = [] } = await req.json();
  if (!Array.isArray(events) || events.length === 0) {
    return jsonResponse({ error: "Missing schedule events" }, 400);
  }
  if (!events.every(isValidEvent)) {
    return jsonResponse({ error: "Invalid schedule events" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const userId = userResult.user.id;

  const { data: connection, error: connectionError } = await serviceClient
    .from("google_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (connectionError || !connection) {
    return jsonResponse({ error: "Google account is not connected" }, 400);
  }

  try {
    let accessToken = connection.access_token;
    const expiresAt = connection.expires_at
      ? new Date(connection.expires_at).getTime()
      : 0;

    if (!accessToken || expiresAt < Date.now() + 60_000) {
      if (!connection.refresh_token) {
        throw new Error("Google refresh token is missing. Sign in again and approve offline access.");
      }

      const refreshed = await refreshGoogleToken(connection.refresh_token);
      accessToken = refreshed.accessToken;

      await serviceClient
        .from("google_connections")
        .update({ access_token: accessToken, expires_at: refreshed.expiresAt })
        .eq("user_id", userId);
    }

    const calendarId = await createGoogleCalendar(accessToken, calendarName);
    let insertedCount = 0;

    for (const event of events as ScheduleEvent[]) {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildGoogleEvent(event)),
        },
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error?.message || "Google Calendar insert failed");
      }

      insertedCount += 1;
    }

    return jsonResponse({ insertedCount, calendarId });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
