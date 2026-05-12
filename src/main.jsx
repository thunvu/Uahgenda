import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { importScheduleToGoogle, saveSchedule } from "./lib/scheduleRepository";
import {
  isSupabaseConfigured,
  persistGoogleConnection,
  signInWithGoogle,
  signOut,
  supabase,
} from "./lib/supabaseClient";
import "./styles.css";
import googleLogo from "../googlelogo.png";

const WEEKDAYS = {
  "thứ hai": "MO",
  "thu hai": "MO",
  "thứ ba": "TU",
  "thu ba": "TU",
  "thứ tư": "WE",
  "thu tu": "WE",
  "thứ năm": "TH",
  "thu nam": "TH",
  "thứ sáu": "FR",
  "thu sau": "FR",
  "thứ bảy": "SA",
  "thu bay": "SA",
  "chủ nhật": "SU",
  "chu nhat": "SU",
};

const CLASS_DURATION_MINUTES = 265;

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function cleanCell(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function cleanCourseName(raw) {
  const beforeMode = raw.split("****")[0];
  const noEmails = beforeMode.replace(/\s*\(Email:[^)]+\)/gi, "");
  const pieces = noEmails.split("-");
  if (pieces.length <= 1) return cleanCell(noEmails);

  return cleanCell(pieces[1]);
}

function parseDate(value) {
  const match = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function parseDateRange(value) {
  const dates = value.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
  return {
    start: dates[0] ? parseDate(dates[0]) : null,
    end: dates[1] ? parseDate(dates[1]) : null,
  };
}

function parseStartTime(value) {
  const match = value.match(/(\d{1,2})h(?:(\d{1,2}))?/i);
  if (!match) return { hour: 7, minute: 0 };
  return {
    hour: Number(match[1]),
    minute: Number(match[2] || 0),
  };
}

function formatDate(date) {
  if (!date) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function toIcsDateTime(date) {
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function toIcsDate(date) {
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function foldIcsLine(line) {
  const chunks = [];
  let rest = line;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function parseSchedule(input) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  let activeCourse = null;

  for (const line of lines) {
    const cells = line.split("\t").map(cleanCell);
    const first = cells[0] || "";
    const normalizedFirst = normalizeText(first);

    if (
      normalizedFirst === "stt" ||
      normalizedFirst.includes("nam hoc") ||
      normalizedFirst.includes("auth platform")
    ) {
      continue;
    }

    const startsWithIndex = /^\d+$/.test(first);
    const startsWithDay = normalizedFirst in WEEKDAYS;

    if (startsWithIndex && cells.length >= 10) {
      activeCourse = {
        index: first,
        rawName: cells[1],
        name: cleanCourseName(cells[1]),
        credits: cells[2],
        className: cells[3],
      };
      entries.push(makeEntry(activeCourse, cells.slice(4)));
      continue;
    }

    if (startsWithDay && activeCourse && cells.length >= 6) {
      entries.push(makeEntry(activeCourse, cells));
    }
  }

  return entries.filter(
    (entry) => entry.startDate && entry.endDate && entry.weekday,
  );
}

function makeEntry(course, cells) {
  const [day, period, room, weeks, campus, address] = cells;
  const range = parseDateRange(weeks || "");
  return {
    ...course,
    day,
    weekday: WEEKDAYS[normalizeText(day)],
    period,
    room,
    weeks,
    campus,
    address,
    startDate: range.start,
    endDate: range.end,
    startTime: parseStartTime(period || ""),
  };
}

function buildIcs(entries, durationMinutes, calendarName) {
  const now = toIcsDateTime(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UAHgenda//UAH Schedule Converter//VI",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(calendarName || "UAHgenda")}`,
    "X-WR-TIMEZONE:Asia/Ho_Chi_Minh",
  ];

  entries.forEach((entry, index) => {
    const start = new Date(entry.startDate);
    start.setHours(entry.startTime.hour, entry.startTime.minute, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const until = new Date(entry.endDate);
    until.setHours(23, 59, 59, 0);

    lines.push(
      "BEGIN:VEVENT",
      `UID:uahgenda-${index}-${toIcsDate(entry.startDate)}@local`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=Asia/Ho_Chi_Minh:${toIcsDateTime(start)}`,
      `DTEND;TZID=Asia/Ho_Chi_Minh:${toIcsDateTime(end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${entry.weekday};UNTIL=${toIcsDateTime(until)}`,
      `SUMMARY:${escapeIcs(entry.name)}`,
      `LOCATION:${escapeIcs([entry.room, entry.address].filter(Boolean).join(" - "))}`,
      "END:VEVENT",
    );
  });

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n");
}

function downloadIcs(content) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "uahgenda.ics";
  anchor.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [rawText, setRawText] = useState("");
  const [calendarName] = useState("Thời khóa biểu UAH");
  const [importCalendarName, setImportCalendarName] =
    useState("Thời khóa biểu UAH");
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const entries = useMemo(() => parseSchedule(rawText), [rawText]);
  const ics = useMemo(
    () => buildIcs(entries, CLASS_DURATION_MINUTES, calendarName),
    [entries, calendarName],
  );

  const courseCount = new Set(entries.map((entry) => entry.rawName)).size;

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      persistGoogleConnection(data.session).catch((error) => {
        setStatusMessage(error.message || "Không lưu được kết nối Google.");
      });
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        persistGoogleConnection(nextSession).catch((error) => {
          setStatusMessage(error.message || "Không lưu được kết nối Google.");
        });
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleImportGoogle(event) {
    event.preventDefault();
    setIsSaving(true);
    setStatusMessage("");

    try {
      const scheduleId = await saveSchedule({
        title: importCalendarName.trim() || "Thời khóa biểu UAH",
        rawText,
        entries,
        durationMinutes: CLASS_DURATION_MINUTES,
      });
      const result = await importScheduleToGoogle(
        scheduleId,
        importCalendarName.trim() || "Thời khóa biểu UAH",
      );
      setIsImportDialogOpen(false);
      setStatusMessage(
        `Đã import ${result.insertedCount || 0} sự kiện vào Google Calendar.`,
      );
    } catch (error) {
      setStatusMessage(error.message || "Không import được Google Calendar.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app">
      <section className="hero">
        <div>
          <p className="eyebrow">
            <span>UAH</span>genda
          </p>
          <h4 className="subcopy">
            Vào mục TKB HỌC KỲ ở trang lịch học và copy toàn bộ nội dung
            (Ctrl+A, Ctrl+C) rồi dán vào ô bên dưới.
          </h4>
        </div>
        <div className="stats" aria-label="Kết quả đọc dữ liệu">
          <div>
            <strong>{entries.length}</strong>
            <span>buổi học</span>
          </div>
          <div>
            <strong>{courseCount}</strong>
            <span>môn</span>
          </div>
        </div>
      </section>

      {isSupabaseConfigured && (
        <section className="accountBar" aria-label="Tài khoản">
          {session ? (
            <>
              <span>{session.user.email}</span>
              <button type="button" onClick={signOut}>
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <span>
                Đăng nhập để lưu lịch và import trực tiếp vào Google Calendar.
              </span>
              <button
                className="googleLoginButton"
                type="button"
                onClick={signInWithGoogle}
              >
                <img src={googleLogo} alt="" aria-hidden="true" />
                Đăng nhập Google
              </button>
            </>
          )}
        </section>
      )}

      <section className="workspace">
        <div className="inputPanel">
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder="Dán toàn bộ nội dung trang thời khóa biểu vào đây..."
            spellCheck="false"
          />

          <div className="actions">
            <button type="button" onClick={() => setRawText("")}>
              Xóa
            </button>
            {isSupabaseConfigured && session && (
              <button
                type="button"
                disabled={!entries.length || isSaving}
                onClick={() => setIsImportDialogOpen(true)}
                style={{
                  backgroundColor: "#4285F4",
                  color: "white",
                  padding: "10px 16px",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                Import Google
              </button>
            )}
            <button
              className="primary"
              type="button"
              disabled={!entries.length}
              onClick={() => downloadIcs(ics)}
            >
              Tải file .ics
            </button>
          </div>
          {statusMessage && <p className="statusMessage">{statusMessage}</p>}
        </div>

        <aside className="guide">
          <h2>Google Calendar</h2>
          <ol>
            <li>
              Tải file <strong>.ics</strong>.
            </li>
            <li>Mở Google Calendar, vào Settings.</li>
            <li>Chọn Import & export, tải file lên lịch mong muốn.</li>
          </ol>
          <h2>
            Hoặc import trực tiếp nếu bạn đã đăng nhập bằng tài khoản Google ở
            trên.
          </h2>
          <p>Lưu ý: Việc đăng nhập bằng google có thể bị giới hạn, khi đó hãy import thủ công.</p>
        </aside>
      </section>

      {isImportDialogOpen && (
        <div className="modalBackdrop" role="presentation">
          <form className="modal" onSubmit={handleImportGoogle}>
            <h2>Đặt tên lịch</h2>
            <label>
              Tên lịch
              <input
                autoFocus
                value={importCalendarName}
                onChange={(event) => setImportCalendarName(event.target.value)}
                placeholder="Thời khóa biểu UAH"
              />
            </label>
            <div className="modalActions">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsImportDialogOpen(false)}
              >
                Hủy
              </button>
              <button
                className="primary"
                type="submit"
                disabled={isSaving || !entries.length}
              >
                {isSaving ? "Đang import..." : "Xác nhận import"}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="preview">
        <div className="previewHeader">
          <h2>Preview</h2>
          <span>
            {entries.length ? "Đã đọc được dữ liệu" : "Chưa có dữ liệu hợp lệ"}
          </span>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Môn học</th>
                <th>Thứ</th>
                <th>Giờ</th>
                <th>Phòng</th>
                <th>Thời gian</th>
                <th>Cơ sở</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr
                  key={`${entry.rawName}-${entry.day}-${entry.weeks}-${index}`}
                >
                  <td>{entry.name}</td>
                  <td>{entry.day}</td>
                  <td>{entry.period}</td>
                  <td>{entry.room}</td>
                  <td>
                    {formatDate(entry.startDate)} - {formatDate(entry.endDate)}
                  </td>
                  <td>{entry.campus}</td>
                </tr>
              ))}
              {!entries.length && (
                <tr>
                  <td colSpan="6" className="empty">
                    Dữ liệu sẽ hiện ở đây sau khi bạn dán bảng thời khóa biểu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
