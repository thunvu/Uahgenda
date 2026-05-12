import { supabase } from "./supabaseClient";

function toDateValue(date) {
  const nextDate = new Date(date);
  const year = nextDate.getFullYear();
  const month = String(nextDate.getMonth() + 1).padStart(2, "0");
  const day = String(nextDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeValue(date) {
  return date.toTimeString().slice(0, 8);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function toGoogleImportEvent(entry, index, durationMinutes) {
  const start = new Date(entry.startDate);
  start.setHours(entry.startTime.hour, entry.startTime.minute, 0, 0);
  const end = addMinutes(start, durationMinutes);
  const endsOn = toDateValue(entry.endDate);

  return {
    id: `uahgenda-${index}-${toDateValue(entry.startDate)}`,
    summary: entry.name,
    starts_on: toDateValue(entry.startDate),
    start_time: toTimeValue(start),
    end_time: toTimeValue(end),
    room: entry.room || null,
    address: entry.address || null,
    recurrence_rule: `FREQ=WEEKLY;BYDAY=${entry.weekday};UNTIL=${endsOn.replaceAll("-", "")}T235959Z`,
  };
}

export async function importScheduleToGoogle({
  entries,
  durationMinutes,
  calendarName = "Thá»i khÃ³a biá»ƒu UAH",
}) {
  if (!supabase) {
    throw new Error("Supabase chÆ°a Ä‘Æ°á»£c cáº¥u hÃ¬nh.");
  }

  const { data: sessionResult, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionResult.session?.access_token) {
    throw new Error("Báº¡n cáº§n Ä‘Äƒng nháº­p Google trÆ°á»›c khi import lá»‹ch.");
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-google-calendar`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${sessionResult.session.access_token}`,
      },
      body: JSON.stringify({
        calendarName,
        events: entries.map((entry, index) =>
          toGoogleImportEvent(entry, index, durationMinutes),
        ),
      }),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "KhÃ´ng import Ä‘Æ°á»£c Google Calendar.");
  }

  return data;
}
