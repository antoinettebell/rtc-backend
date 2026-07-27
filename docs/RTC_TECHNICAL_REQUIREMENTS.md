# Round Da' Corner ERP - Technical Requirements

Last updated: July 27, 2026

## 1. System Components

The platform consists of:

- `rtc-customer-mobile-app`: React Native customer mobile application.
- `rtc-vendor-mobile-app`: React Native vendor/employee mobile application.
- `rtc-backend`: Node.js/Express backend API.
- `rtc-admin-frontend`: Next.js admin portal.

## 2. Roles and Access

The backend must enforce role-based access for:

- `CUSTOMER`
- `VENDOR`
- `EMPLOYEE`
- `SUPER_ADMIN`
- Event coordinator/customer-side organizer roles where implemented.

Protected APIs must validate JWT/session token state and reject unauthorized role access.

## 3. Mobile Technical Requirements

### 3.1 React Native

- Support iOS and Android builds.
- Avoid duplicate React keys in rendered lists.
- Avoid unhandled navigation actions.
- Use existing theme tokens for dark blue, light blue, and green.
- Keep customer and vendor location/map configuration aligned.
- Use persistent state only for appropriate user-scoped items, such as acknowledged notification IDs.

### 3.2 Vendor App

Required screens and behaviors:

- Auth intro/loading screen with branded assets.
- Food truck profile onboarding.
- Save & Exit from approved vendor profile setup.
- Vendor Home notification summary modal.
- Vendor notification badge computed from:
  - pending push order notifications.
  - unseen Event Source-to-Pay notifications.
- Bell tap must:
  - open notification list.
  - clear new/unread badge state.
  - mark Event Source-to-Pay message notifications read when possible.
  - persist seen Event Source-to-Pay action notifications locally by vendor user ID.
- Compliance page with food truck dropdown and per-truck document state.
- Orders page must show backend error messages instead of generic failure text.
- Employee state field should use standardized dropdown values.

### 3.3 Customer App

Required screens and behaviors:

- Auth intro/loading screen with branded visuals.
- Explore page must avoid header text overlap.
- Sanitation grade display logic:
  - Show grade next to reviews only if verified/non-expired grade is present.
  - Hide grade entirely if none is provided.
- Event images must support zoom in/out.
- Message text must wrap and stay inside viewport/card boundaries.

## 4. Backend API Requirements

### 4.1 Authentication

- Login returns authenticated user and auth token.
- Admin portal must only allow `SUPER_ADMIN`.
- Non-admin users must be rejected from admin portal access.

### 4.2 Event Source-to-Pay

Backend must support:

- Open Event Source-to-Pay events for vendors.
- Vendor bids/applications.
- Draft, submit, withdraw, revision, award, accepted, not-selected, payment-due, and closed states.
- Event questions/messages.
- Message read tracking by role.
- Notification summary for vendor Event Source-to-Pay messages/actions.
- Attachment uploads for bids/applications.
- Coordinator/admin review of uploaded files.

### 4.3 Compliance

Backend must support:

- Per-vendor and per-food-truck compliance documents.
- Compliance score calculation.
- Expiration status detection.
- Sanitation grade extraction/verification fields.
- Manual sanitation grade storage when OCR cannot determine grade.
- Admin verification status.
- Customer-facing sanitation grade map for verified/non-expired records.

### 4.4 Orders

Backend must support:

- Vendor order status updates.
- Stale order cleanup policy for old active orders.
- Restrict refund/void behavior to orders with gateway payment transactions.
- Return actionable error messages to the mobile app.

### 4.5 Earnings

Backend/app earnings calculations must follow:

```text
Vendor Earnings = gross sales + customer tips
Excluded = tax + delivery fee + driver tip
No app fees deducted in vendor app display
```

## 5. OCR and Moderation Requirements

OCR processing must evaluate uploaded images/documents for:

- contact data,
- social handles,
- QR codes,
- direct payment handles,
- prohibited off-platform instructions,
- sanitation grade extraction,
- compliance document expiration data where applicable.

OCR results should produce:

- pass,
- blocked/rejected,
- pending admin review,
- extracted structured fields,
- moderation reasons.

## 6. Data Requirements

Core entities include:

- User
- FoodTruck
- TruckUnit
- Location
- Order
- MarketplaceEvent backend entity
- MarketplaceBid backend entity
- MarketplaceApplication backend entity
- MarketplaceAttachment backend entity
- MarketplaceEventQuestion backend entity
- ComplianceDocument
- Transaction/Payment
- Employee
- Notification

Food truck records must support:

- logo,
- food photos,
- menu files,
- truck units,
- current/open locations,
- verified sanitation grade exposure.

## 7. Admin Portal Technical Requirements

Admin frontend must:

- Use Next.js.
- Use shared Tailwind/CSS variable tokens for brand colors.
- Provide branded split-panel sign-in page.
- Restrict access to authenticated admin users.
- Display and manage Event Source-to-Pay, compliance, users, vendors, orders, transactions, content, and settings.
- Support S3/static deployment if configured through `out/` build output.

## 8. Validation Requirements

Before release:

- Run mobile syntax checks for changed JS files.
- Run backend syntax checks for changed JS files.
- Run admin TypeScript/build validation.
- Known current admin TypeScript issues should be resolved separately:
  - `src/app/(main)/compliance/page.tsx`
  - `src/app/(main)/event-coordinators/page.tsx`
  - `src/app/(main)/marketplace-repository/page.tsx`

## 9. Deployment Requirements

Local update commands should support:

```powershell
git -C C:\RTC_DEV\rtc-vendor-mobile-app pull --ff-only origin main
git -C C:\RTC_DEV\rtc-customer-mobile-app pull --ff-only origin main
git -C C:\RTC_DEV\rtc-backend pull --ff-only origin main
git -C C:\RTC_DEV\rtc-admin-frontend pull --ff-only origin main
```

Backend deployment should include:

- pull latest code,
- install dependencies if changed,
- restart service,
- verify logs.

Admin deployment should include either:

- server runtime restart, or
- static build and S3 sync if hosted as a static site.
