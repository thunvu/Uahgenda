# UAHgenda Backend

Backend dung Supabase:

- Supabase Auth cho Google login.
- Supabase Postgres chi luu ket noi Google OAuth can cho import.
- Edge Functions cho viec luu Google OAuth token va import truc tiep vao Google Calendar.

## Database

Migration chinh nam o:

```txt
supabase/migrations/20260512143000_initial_backend.sql
```

Bang duy nhat cua app:

- `google_connections`: Google OAuth token, chi Edge Function dung service role duoc doc/ghi.

App khong luu profile, thoi khoa bieu da paste, hay event da parse. Khi import, frontend gui danh sach event truc tiep den Edge Function, function tao event tren Google Calendar roi ket thuc request.

## Local Env

Tao `.env` tu `.env.example`:

```txt
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

## Google OAuth

Trong Supabase Dashboard, bat Google provider.

Scope app dang xin:

```txt
openid email profile https://www.googleapis.com/auth/calendar.events
```

App cung gui:

```txt
access_type=offline
prompt=consent
```

de Google tra `provider_refresh_token` khi user dong y.

## Edge Function Secrets

Set secrets cho Supabase Functions:

```bash
supabase secrets set GOOGLE_CLIENT_ID=...
supabase secrets set GOOGLE_CLIENT_SECRET=...
```

`SUPABASE_SERVICE_ROLE_KEY` la bien he thong cua Supabase Edge Functions.

## Functions

```txt
supabase/functions/save-google-connection/index.ts
supabase/functions/import-google-calendar/index.ts
```

Luong hoat dong:

1. User dang nhap Google.
2. Frontend goi `save-google-connection` de backend luu provider token.
3. User dan lich va bam `Import Google`.
4. Frontend gui entries da parse truc tiep den `import-google-calendar`.
5. Edge Function refresh Google token neu can, tao Google Calendar moi, roi insert events.

## Deploy Sau Nay

Khi co Supabase project:

```bash
supabase db push
supabase functions deploy save-google-connection
supabase functions deploy import-google-calendar
```
