# Dashboard login setup

Login is always required. Until Google sign-in and email delivery are configured,
the app shows the login panel and denies access to protected data. There is no
development login or password bypass.

## Owner and roles

The super-admin account is **tradingviewfx108@gmail.com**. This role is activated only
after Google verifies that identity and the owner enters the separate email code.
Super admins and admins use Google sign-in only. Clients can use Google or their
own dashboard password; this password is separate from their Google password.

Only the super admin can add, remove, or change admins. Any admin can approve,
suspend, remove, restore, or renew clients. All users must verify email. New users
remain pending until approved. Preapproved users must still verify ownership of
their Gmail address. Gmail dot/plus aliases map to one account.

When adding an admin, **No expiry** is selected by default. The super admin can
uncheck it and choose an access expiry date. Existing admin rows always show an
**Expiry option** selector with **No expiry** and **Set expiry date**. Choosing
No expiry removes a saved date and hides the date field; choosing Set expiry
date shows the field and saves the selected date when leaving it. The new-admin
form also hides its date field while No expiry is checked. This controls account access; browser
sign-in sessions still last 30 days.

For an ownership handover, the previous super admin retains access until the
new configured owner completes Google sign-in and the email code. Completing
that verification revokes the previous owner's sessions and removes their
dashboard access. A Google callback alone cannot grant the new owner privileges.

Clients cannot control MT5, Telegram, shared strategy settings, or shared memory.
MT5 accounts, money balances/profits, positions, signals, logs, and broker trade
history are excluded from client responses. Clients can use chart features and
keep a personal journal; their journal writes never modify the shared journal.
Browser chart/drawing/chat storage is separated by account.

## Configure Google

1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Configure the consent screen with the app name and support contact. If the
   Google app is in testing, add the intended accounts as test users.
3. Add the exact authorized redirect URI:
   `http://127.0.0.1:3002/api/auth/google/callback` for the current local app.
4. In the local `.env` file, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
   `AUTH_PUBLIC_URL=http://127.0.0.1:3002`.
5. For hosted access, use the public HTTPS origin for `AUTH_PUBLIC_URL` and add
   its `/api/auth/google/callback` address to the OAuth client. Open the app at
   that exact origin; localhost and 127.0.0.1 are different origins.

Google setup reference:
https://developers.google.com/identity/openid-connect/openid-connect

## Configure verification emails

The implementation sends transactional mail through Resend. Create an API key,
verify your sending domain, and set these server-only values in `.env`:

```dotenv
RESEND_API_KEY=your-private-api-key
AUTH_EMAIL_FROM=Trading Dashboard <login@your-verified-domain.example>
```

Keep credentials local; never commit them or send passwords in chat. No password,
verification code, reset link, Google token, or session token is logged. The app
does not send messages while running its automated tests.

Resend reference: https://resend.com/docs/api-reference/emails/send-email

Restart the dashboard after configuration. Sign in with the owner's Google
account, enter the emailed six-digit code, then open **User Management**.

## Sessions and storage

- Codes expire after 5 minutes, are single use, and allow at most 5 incorrect
  attempts. Resending invalidates the previous code and has a 60-second cooldown.
- Reset links expire after 15 minutes, are single use, and invalidate existing
  sessions and pending codes when used. Only clients can reset a dashboard
  password. A Google-only client can set a dashboard password via this same flow.
- Login/code requests have IP and account limits. All roles stay signed in on
  the verified browser for 30 days. New browsers/devices, cleared cookies,
  explicit sign-out, or expired sessions require sign-in and a new email code.
  Refreshing, reopening the browser, and changing networks do not reset the
  verification deadline. Session checks never extend it beyond 30 days from
  verification. Active legacy eight-hour sessions are upgraded on the next
  session check, without requesting another code.
  Approval, suspension, role, and expiry changes revoke sessions; every protected
  API request checks current access. The interface rechecks every 15 seconds and
  when the tab regains focus. Expired/suspended users receive no protected data.
- Auth cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. Writes require the
  configured origin. Google authorization uses a cookie-bound state and PKCE;
  identity comes from Google's authenticated userinfo endpoint.
- The private `.dashboard-auth/` directory stores account metadata, scrypt password
  hashes, hashed sessions/codes/reset tokens, personal journals and activity. It
  is excluded from Git and never served as static content. Preserve this directory
  when moving the app. Use one running server process with persistent private
  storage; this file store is not a shared multi-instance database.
- The Python bridge continues using its existing `MT5_BRIDGE_TOKEN` for its exact
  machine endpoints, including its status/configuration read. That token cannot
  authorize user management, account listings, or configuration writes. A token must
  be configured in both `.env` and `.env.mt5`; loopback alone is insufficient.

The system intentionally has no separate super-admin recovery flow, extra
confirmation dialogs, or deleted-record recycle bin, as requested.
