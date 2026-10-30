# RYVO — Supabase and payment setup

## Server-side secrets
Set these in the hosting provider's secret/environment settings (never in frontend code or committed files):

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`)
- `ADMIN_EMAILS` — comma-separated email allowlist for administrators
- `FAMGATEWAY_API_KEY` — only when FamGateway online checkout is enabled
- `SITE_URL` — canonical HTTPS URL for the deployed store

## Browser configuration
The browser must only receive the publishable key:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never put the Supabase secret/service-role key or FamGateway API key in a `VITE_` variable.

## Admin sign-in
Create/confirm an administrator account in Supabase Auth, then put that exact email in `ADMIN_EMAILS`. The admin panel signs in through Supabase Auth and sends the access token to protected API routes. The backend rejects missing, invalid, expired, or non-allowlisted sessions.

## FamGateway checkout
Online checkout is disabled unless Supabase, `FAMGATEWAY_API_KEY`, and `SITE_URL` are configured. The backend stores the FamGateway order reference and verifies webhook HMAC-SHA256 signatures against the raw request body before marking payment successful. If a checkout session cannot be created, the backend calls `cancel_pending_order_and_restore_stock` so the pending order is cancelled and reserved stock is restored together.

FamGateway's published webhook contract documents the `X-FamGateway-Signature` HMAC-SHA256 header and uses the merchant API key as the HMAC secret. Confirm this contract with the merchant account if their dashboard/docs differ.

## Database safety
The connected project already has the seven application tables and existing records. The two dated SQL files under `supabase/migrations/` correspond to the additive migrations recorded in the connected project's migration history. Do not manually rerun them against production without checking migration history first.

`db_schema.sql` is a bootstrap/seed script for a fresh project, not a production migration. Do not rerun it over the live database.

## Validation status
TypeScript/TSX syntax transpilation passed for the changed server and admin files. A full dependency-backed `npm run lint` / production build could not be completed in this environment because `npm install` timed out; rerun those checks in the project's normal build environment before deployment.
