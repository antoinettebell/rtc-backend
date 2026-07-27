# Round Da' Corner ERP - Architecture Review

Last updated: July 27, 2026

## 1. Executive Summary

Round Da' Corner ERP is implemented as a multi-client platform with two React Native mobile apps, one Next.js admin portal, and a Node.js/Express API backend. The architecture is appropriate for the current product stage because it separates customer, vendor, admin, and backend responsibilities while preserving shared backend policy enforcement.

The main architectural strengths are:

- clear client separation by user audience,
- backend-controlled Event Source-to-Pay and compliance policies,
- role-based access enforcement,
- OCR-assisted compliance/moderation direction,
- scalable admin portal for operational workflows.

The main areas needing continued discipline are:

- centralizing business rules in backend services,
- avoiding duplicated UI/business logic across mobile apps,
- formalizing notification persistence for all Event Source-to-Pay action alerts,
- completing admin TypeScript cleanup,
- documenting deployment environments and secrets.

## 2. Current Architecture

```text
Customer Mobile App      Vendor Mobile App       Admin Portal
React Native             React Native            Next.js
      |                         |                     |
      +------------- HTTPS/API -+---------------------+
                            |
                       Backend API
                    Node.js / Express
                            |
        Database / Storage / Payment / OCR / Push Services
```

## 3. Application Layer Review

### 3.1 Customer Mobile App

Responsibilities:

- customer authentication,
- food truck discovery,
- ordering,
- favorites,
- Event Source-to-Pay viewing,
- event messages,
- verified sanitation grade display.

Review:

- Customer app is correctly focused on discovery and ordering.
- Sanitation grade display should remain read-only and backend-derived.
- Explore UI now aligns better with brand expectations.

Recommended next improvements:

- create shared helper utilities for location/map behavior,
- centralize review/rating display formatting,
- standardize image zoom component reuse.

### 3.2 Vendor Mobile App

Responsibilities:

- vendor profile setup,
- food truck operations,
- ordering operations,
- Event Source-to-Pay participation,
- compliance management,
- staff/employee management,
- earnings,
- notifications.

Review:

- Vendor app has the broadest workflow surface.
- Notification badge behavior now clears on bell tap using local seen state plus backend message read marking.
- Compliance workflow now supports per-food-truck sanitation grade handling.
- Save & Exit during profile setup reduces navigation dead ends.

Recommended next improvements:

- move repeated Event Source-to-Pay notification modal UI into a reusable component,
- formalize persisted notification state in backend if action alerts must sync across devices,
- create one state dropdown component used by all address forms.

### 3.3 Admin Portal

Responsibilities:

- operational management,
- vendor/user/event coordinator oversight,
- compliance review,
- Event Source-to-Pay repository and payments,
- content/settings management.

Review:

- Admin portal now uses RTC brand colors and a branded sign-in screen.
- The portal has existing TypeScript issues unrelated to the visual updates.

Recommended next improvements:

- resolve TypeScript errors before production deployment,
- create a reusable status badge design system,
- remove stale copy files and duplicate page artifacts when safe.

## 4. Backend Layer Review

Responsibilities:

- authentication,
- role-based authorization,
- Event Source-to-Pay rules,
- compliance rules,
- order rules,
- earnings data,
- payment/refund rules,
- file metadata,
- OCR/moderation orchestration.

Review:

- Backend is the correct place for Event Source-to-Pay policy and stale order rules.
- Sanitation grade visibility is correctly backend-derived for customer display.
- Stale order cleanup policy is moving in the correct direction.

Recommended next improvements:

- add explicit endpoints for acknowledging Event Source-to-Pay action notifications,
- add scheduled compliance expiration recalculation,
- document order status transitions in a state machine,
- add regression tests for earnings and order cleanup.

## 5. Data and State Review

### Persistent State

Should live in backend/database:

- users,
- food trucks,
- Event Source-to-Pay records,
- compliance documents,
- orders,
- payments,
- verified sanitation grades,
- message read timestamps,
- uploaded file metadata.

### Local Client State

Acceptable for:

- UI modal state,
- selected tabs/filters,
- temporary form drafts before save,
- user-scoped seen notification IDs where backend support does not yet exist.

Architectural risk:

- Local notification seen state does not sync across devices. If vendors use multiple devices, backend notification acknowledgement should replace local-only action alert seen state.

## 6. Security Review

Current security-sensitive areas:

- admin login and role enforcement,
- uploaded files and OCR moderation,
- payment and refund handling,
- direct contact information blocking,
- compliance document handling,
- EIN/SSN handling.

Requirements:

- Never expose W-9/EIN/SSN as public Event Source-to-Pay artifacts.
- Use role-based backend checks, not client-only hiding.
- Limit customer-facing compliance data to verified, non-sensitive fields.
- Keep payment/refund logic gateway-aware.
- Avoid logging sensitive document or payment data.

## 7. OCR/Moderation Review

OCR should operate as a policy enforcement layer for:

- off-platform contact prevention,
- payment handle prevention,
- social media/contact prevention,
- compliance field extraction,
- sanitation grade verification support.

Best architecture:

```text
Upload -> Store File -> OCR Job -> Moderation Result -> App/Admin Status
```

The mobile app should not be the authority for OCR decisions. It should display backend decisions and allow admin review.

## 8. Notification Architecture Review

Current behavior:

- Order push notifications use Redux persisted queue/current order state.
- Event Source-to-Pay messages use backend read timestamps.
- Event Source-to-Pay action alerts are derived from current Source-to-Pay record status.
- Vendor Home badge clears when bell is opened.

Recommended future design:

- Create `NotificationReceipt` or `UserNotificationState` backend collection.
- Store `user_id`, `notification_key`, `seen_at`, `read_at`, and `source`.
- Use it for awards, closed events, not-selected, payment due, compliance warnings, and messages.

This would make notification state consistent across app reinstall and multiple devices.

## 9. Deployment Review

Current deploy surfaces:

- backend server over SSH/process manager,
- mobile app builds through Xcode/Android tooling,
- admin portal through server or S3/static output depending on hosting.

Recommended:

- create one deployment runbook per repo,
- document environment variables,
- verify admin hosting mode,
- add post-deploy smoke checklist.

## 10. Release Readiness Checklist

- Vendor app rebuild completed.
- Customer app rebuild completed.
- Backend deployed and logs checked.
- Admin portal deployed and cache cleared where applicable.
- Admin TypeScript issues reviewed.
- Vendor Home notification badge tested.
- Compliance grade upload/revise flow tested.
- Customer sanitation grade display tested.
- Event Source-to-Pay messages tested.
- Stale order cleanup tested.
- Earnings calculation verified against known order totals.

## 11. Architecture Verdict

The architecture is suitable for launch stabilization if remaining defects are limited to UI/edge-case bugs. The platform should avoid major new feature work until:

- admin TypeScript issues are cleaned up,
- deployment procedures are documented,
- key order/compliance/Event Source-to-Pay flows are regression tested,
- notification acknowledgement is moved fully server-side if multi-device support becomes important.
