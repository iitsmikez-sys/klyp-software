# Reset-password email (Supabase dashboard setting)

Do this once in Supabase: **Authentication, Emails (Email Templates), Reset Password**.

**Subject:** Reset your Klyp password

**Body (HTML):**

```html
<h2>Reset your Klyp password</h2>
<p>We received a request to reset your password. Tap the button below to choose a new one.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>
```

Why: the link goes to `/auth/confirm` (app/auth/confirm/route.ts), which works in any browser. Supabase's default
link only works in the same browser where "Forgot password?" was pressed.

`{{ .SiteURL }}` is the Site URL in Authentication, URL Configuration. It must be `https://www.klyp.world`.
