import { supabase } from "./supabaseClient";

const WEEKDAY_LABELS = {
  MO: "Thứ Hai",
  TU: "Thứ Ba",
  WE: "Thứ Tư",
  TH: "Thứ Năm",
  FR: "Thứ Sáu",
  SA: "Thứ Bảy",
  SU: "Chủ Nhật"
};

function toDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toTimeValue(date) {
  return date.toTimeString().slice(0, 8);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function saveSchedule({ title, rawText, entries, durationMinutes }) {
  if (!supabase) {
    throw new Error("Supabase chưa được cấu hình.");
  }

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userResult.user) {
    throw new Error("Bạn cần đăng nhập Google trước khi lưu lịch.");
  }

  const userId = userResult.user.id;
  const sourceHash = await sha256(rawText);

  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .insert({
      user_id: userId,
      title,
      source_hash: sourceHash,
      event_count: entries.length
    })
    .select("id")
    .single();

  if (scheduleError) throw scheduleError;

  const rows = entries.map((entry) => {
    const start = new Date(entry.startDate);
    start.setHours(entry.startTime.hour, entry.startTime.minute, 0, 0);
    const end = addMinutes(start, durationMinutes);

    return {
      schedule_id: schedule.id,
      user_id: userId,
      summary: entry.name,
      class_name: entry.className || null,
      credits: Number(entry.credits) || null,
      weekday: entry.weekday,
      starts_on: toDateValue(entry.startDate),
      ends_on: toDateValue(entry.endDate),
      start_time: toTimeValue(start),
      end_time: toTimeValue(end),
      room: entry.room || null,
      campus: entry.campus || null,
      address: entry.address || null,
      recurrence_rule: `FREQ=WEEKLY;BYDAY=${entry.weekday};UNTIL=${toDateValue(entry.endDate).replaceAll("-", "")}T235959Z`,
      raw: {
        day: entry.day || WEEKDAY_LABELS[entry.weekday],
        period: entry.period,
        weeks: entry.weeks,
        rawName: entry.rawName
      }
    };
  });

  const { error: eventsError } = await supabase.from("schedule_events").insert(rows);
  if (eventsError) throw eventsError;

  return schedule.id;
}

export async function importScheduleToGoogle(scheduleId, calendarName = "Thời khóa biểu UAH") {
  if (!supabase) {
    throw new Error("Supabase chưa được cấu hình.");
  }

  const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionResult.session?.access_token) {
    throw new Error("Bạn cần đăng nhập Google trước khi import lịch.");
  }

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-google-calendar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${sessionResult.session.access_token}`
    },
    body: JSON.stringify({ scheduleId, calendarName })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Không import được Google Calendar.");
  }

  return data;
}
