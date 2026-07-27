# Round Da' Corner ERP - Business Requirements

Last updated: July 27, 2026

## 1. Purpose

Round Da' Corner ERP is a multi-app platform for food truck discovery, ordering, Event Source-to-Pay participation, vendor operations, compliance management, employee management, and admin oversight.

The platform supports four primary audiences:

- Customers who discover food trucks, order food, view events, and message coordinators.
- Vendors who manage food trucks, orders, Event Source-to-Pay applications, compliance documents, staff, menus, earnings, and availability.
- Event coordinators who publish events, review vendor submissions, message vendors, award participation, and manage event payments.
- Admins who manage users, vendors, Event Source-to-Pay records, compliance, transactions, content, categories, notifications, and system oversight.

## 2. Business Goals

- Provide customers a modern food truck discovery and ordering experience.
- Give vendors one operational system for Event Source-to-Pay events, ordering, compliance, staff, and financial reporting.
- Give event coordinators a controlled vendor selection and communication workflow.
- Reduce manual compliance review through OCR-assisted document validation.
- Prevent vendors from bypassing platform communication rules by blocking contact information in public Event Source-to-Pay submissions and uploaded materials.
- Maintain platform trust by surfacing verified compliance data, including sanitation grade only when applicable.
- Support cleanup of stale orders that never progress.
- Provide admins a branded, centralized ERP portal for operational management.

## 3. Scope

### 3.1 Customer App

The customer app must support:

- Branded loading and login/intro experience.
- Explore page with current location display, food truck search, featured trucks, favorites, and events.
- Near Me Event Source-to-Pay discovery.
- Food truck/customer ordering flow.
- Favorite food trucks.
- Event details with zoomable images.
- Messages related to events and coordinator responses.
- Sanitation grade display next to reviews only when the truck has a verified grade.

### 3.2 Vendor App

The vendor app must support:

- Branded loading and login/intro experience.
- Approved vendor profile onboarding.
- Save & Exit from profile onboarding so approved vendors can finish later.
- Food truck profile management with logo, truck photos, EIN/SSN field, social handle, locations, and truck units.
- Vendor Home page with notification bell and unread badge clearing once notifications are viewed.
- Event Source-to-Pay event list, applications, messages, awards, closed/not-selected indicators, and unread message indicators.
- Vendor application drafts, submission, withdrawal, attachments, menu files, and food/menu photos.
- OCR-supported review of uploaded photos/documents for contact/social information and compliance requirements.
- Compliance page with per-food-truck sanitation grade upload, OCR review, admin verification state, edit/revise grade behavior, expiration tracking, and score updates.
- Orders page with active/past order management and stale order cleanup support.
- Earnings page using straight math: gross sales plus tips, excluding delivery, tax, and driver tip; no app fees deducted.
- Employee management, including standardized state dropdown values.

### 3.3 Admin Portal

The admin portal must support:

- Branded admin sign-in page.
- RTC brand color system: dark blue, light blue, and green.
- User and vendor management.
- Event coordinator management.
- Event Source-to-Pay repository management.
- Event Source-to-Pay payments and transaction oversight.
- Compliance dashboard and document review.
- Vendor detail review including loaded photos/menu files.
- Category, cuisine, diet, banner, coupon/reward, notification, and settings management.

### 3.4 Backend

The backend must support:

- Authentication and role-based access control for customer, vendor, employee, event coordinator, and admin roles.
- Food truck, order, Event Source-to-Pay, compliance, employee, earnings, notification, payment, file, and OCR-related APIs.
- Policy enforcement for Event Source-to-Pay visibility and communications.
- Vendor stale order status updates according to backend policy.
- Sanitation grade lookup and customer-facing grade exposure only when verified and non-expired.
- Compliance score recalculation when documents expire or are updated.

## 4. Key Business Rules

### 4.1 Earnings

- Vendor earnings must be calculated as:
  - Gross sales plus customer tips.
  - Exclude tax.
  - Exclude delivery fee.
  - Exclude driver tip.
  - Do not deduct app fees inside the vendor app.

### 4.2 Event Source-to-Pay Communication

- Vendors and coordinators may exchange platform-controlled messages.
- Uploaded photos and Event Source-to-Pay text must not expose direct contact or off-platform information.
- Messages with unread responses must display a notification indicator.
- Once a vendor taps the notification bell, those notifications are considered seen and no longer new.

### 4.3 Event Source-to-Pay Applications

- Vendors may submit applications or bids where event rules allow.
- Vendors must be able to save drafts before final submission.
- Coordinators/admins should be able to request revisions before award.
- Applications should show loaded menu files and food/menu photos on the customer/admin side.
- W-9 and EIN are not event application requirements.
- Certificate of Insurance and event-specific required documents may be requested.

### 4.4 Compliance

- Compliance score must update when any document becomes expired.
- Sanitation grade is food-truck-specific.
- Sanitation grade is optional because not all food trucks require one.
- If a verified sanitation grade exists, the customer app must show it next to rating/review count.
- If no verified sanitation grade exists, the customer app must omit sanitation grade entirely.
- Sanitation grade becomes read-only after save unless the vendor clicks revise/edit.
- OCR checks sanitation grade after save.
- If OCR cannot determine the grade, the grade remains pending until admin verification.
- Once admin verifies the grade, it remains read-only until the vendor chooses to revise and upload a new document.

### 4.5 Uploaded Photos and OCR

OCR should block or flag:

- Phone numbers.
- Email addresses.
- Websites and URLs.
- Social media handles or platform names used as contact methods.
- QR codes that route off-platform.
- Cash App, Venmo, PayPal, Zelle, Apple Cash, or similar payment handles.
- Physical mailing addresses when used as a direct contact channel.
- "Call/text/order directly" instructions.
- Business cards or flyers that expose direct off-platform contact.

OCR should not block:

- Food names.
- Menu item descriptions.
- Prices.
- Normal event details.
- Sanitation grade text.
- Government document labels required for compliance.

### 4.6 Orders

- Vendors need a way to clear or complete stale orders that never move.
- Backend policy must allow stale active orders to be moved to rejected/completed when the configured stale threshold is met.
- Payment refund/void behavior must only run when a real gateway payment exists.

## 5. Notifications

The system must notify or visually indicate:

- New vendor orders.
- Unread Event Source-to-Pay messages.
- Event Source-to-Pay awards or accepted applications.
- Event Source-to-Pay not-selected or closed events.
- Payment/action due.
- Compliance expirations or required document updates.

Notification indicators must clear when the recipient views the notification list or reads the relevant message thread.

## 6. Non-Functional Requirements

- Mobile apps must avoid development redbox warnings for normal user actions.
- App navigation must not call back/reset actions when no navigator can handle them.
- Upload workflows must retain selected files/photos consistently after save or submission.
- Customer and vendor Google Maps/location behavior must use consistent API configuration.
- UI colors must follow the existing brand palette.
- Admin portal must be deployable to the current hosting target without changing business logic.

## 7. Acceptance Criteria

- Customer can open the app, log in, search, browse, and see properly aligned Explore content.
- Vendor can open the app, complete or save profile onboarding, and exit safely.
- Vendor Home notification badge clears when bell is tapped.
- Vendor compliance allows selecting a food truck and saving/revising sanitation grade documents.
- Customer view shows sanitation grade only for verified graded trucks.
- Event Source-to-Pay applications retain and display uploaded menu/photos where permitted.
- Admin sign-in page reflects RDC ERP branding.
- Old/stale orders can be transitioned under backend policy.
- Earnings reports match verified gross sales plus tip math.
