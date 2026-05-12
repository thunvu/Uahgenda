# UAHgenda Backend

Backend dùng Supabase:

- Supabase Auth cho Google login.
- Supabase Postgres cho lịch và event đã parse.
- Row Level Security để user chỉ đọc/ghi dữ liệu của mình.
- Edge Functions cho việc lưu Google OAuth token và import trực tiếp vào Google Calendar.

## Database

Migration chính nằm ở:

```txt
supabase/migrations/20260512143000_initial_backend.sql
```

Các bảng:

- `profiles`: thông tin user từ Supabase Auth.
- `schedules`: mỗi lần người dùng lưu một thời khóa biểu.
- `schedule_events`: từng buổi học đã parse.
- `google_connections`: Google OAuth token, chỉ Edge Function dùng service role được đọc/ghi.

## Local Env

Tạo `.env` từ `.env.example`:

```txt
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

## Google OAuth

Trong Supabase Dashboard, bật Google provider.

Scope app đang xin:

```txt
openid email profile https://www.googleapis.com/auth/calendar.events
```

App cũng gửi:

```txt
access_type=offline
prompt=consent
```

để Google trả `provider_refresh_token` khi user đồng ý.

## Edge Function Secrets

Set secrets cho Supabase Functions:

```bash
supabase secrets set GOOGLE_CLIENT_ID=...
supabase secrets set GOOGLE_CLIENT_SECRET=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

## Functions

```txt
supabase/functions/save-google-connection/index.ts
supabase/functions/import-google-calendar/index.ts
```

Luồng hoạt động:

1. User đăng nhập Google.
2. Frontend gọi `save-google-connection` để backend lưu provider token.
3. User dán lịch và bấm `Lưu lịch`.
4. Frontend lưu `schedules` và `schedule_events`.
5. User bấm `Import Google`.
6. Edge Function `import-google-calendar` đọc event, refresh Google token nếu cần, rồi gọi Google Calendar API.

## Deploy Sau Này

Khi có Supabase project:

```bash
supabase db push
supabase functions deploy save-google-connection
supabase functions deploy import-google-calendar
```
