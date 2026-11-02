# V6 roadmap (revised)

Two official phases only: **Phase 1 – Complete development**, **Phase 2 – Production & release**. Slices are internal order, not phases.

## Decision: payments are postponed
Not built and not stubbed: payment gateways, mobile money, payment processing, commissions, payouts, refunds, payment disputes. No fake payment screens or
"coming soon" placeholders exist in the app. Premium plans and AI credits are designed as **admin-granted entitlements** (no paid activation).

## MVP order
1. Offline Media Library — **done in code, awaiting device/Supabase verification** (see docs/OFFLINE_MEDIA.md)
2. Community real-time live chat — **code complete, awaiting verification** (docs/CHAT.md)
   - corrections to Slice 1/offline media done in the same delivery
3. Voice messages — **code complete, awaiting verification** (docs/VOICE.md)
4. Voice posts and voice comments — **code complete, awaiting verification** (docs/VOICE.md)
5. Professionals marketplace (registration, verification, profiles, services, availability)
6. Appointments and booking management (free to request; any fee is agreed between the people involved, outside the app for now)
7. Admin dashboard
8. Core security, testing and optimisation

## Keeping payments addable later (no rewrite needed)
- Bookings and subscriptions will use an explicit **status field + append-only event table**, so a "payment pending/paid" step can later be inserted into the status flow without changing existing rows.
- Entitlements (plan, AI credits) are read through server-side functions only, so changing how they are granted (admin today, payment tomorrow) does not touch the screens.
- All money-adjacent values will be stored as integer TZS, never floats.
