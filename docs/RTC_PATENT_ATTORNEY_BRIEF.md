# Round Da' Corner ERP - Patent Attorney Brief

Last updated: July 27, 2026

Important: This document is not legal advice. It is an invention disclosure-style brief to help prepare for a meeting with a patent attorney. Counsel should determine patentability, claim strategy, filing deadlines, inventorship, prior art search scope, and whether patent, copyright, trademark, or trade secret protection is most appropriate.

## 1. Product Name

Round Da' Corner ERP

## 2. Short Description

Round Da' Corner ERP is a multi-sided food truck operations and Event Source-to-Pay platform that connects customers, vendors, event coordinators, and administrators. It combines food truck discovery, ordering, Event Source-to-Pay participation, compliance document management, OCR-assisted moderation, sanitation grade verification, vendor operations, staff management, and admin oversight.

## 3. Problem Being Solved

Food truck vendors and event coordinators currently rely on fragmented tools for:

- customer discovery,
- order management,
- event applications,
- vendor selection,
- vendor compliance,
- sanitation grade verification,
- document collection,
- menu/photo review,
- payment handling,
- staff operations,
- customer-facing trust signals.

Existing workflows are manual, inconsistent, and difficult to audit. Event coordinators often need to review vendor photos, menus, insurance, permits, sanitation grades, and communications while preventing off-platform contact and ensuring customers only see verified compliance information.

## 4. Proposed Invention Concepts

The attorney should evaluate whether any of the following are protectable individually or as combinations.

### 4.1 OCR-Assisted Vendor Event Source-to-Pay Compliance Gate

A system that receives vendor Event Source-to-Pay submissions and uploaded media, performs OCR/moderation checks, and blocks or routes submissions for review when the content contains prohibited contact or payment information.

Potentially novel combination:

- food truck/Event Source-to-Pay application,
- uploaded food/menu/business images,
- OCR extraction,
- contact/social/payment handle detection,
- automated rejection or admin review,
- platform-controlled coordinator/vendor communication.

### 4.2 Conditional Sanitation Grade Verification and Display

A workflow where sanitation grade documents are uploaded per food truck, OCR attempts to extract the grade and expiration, admin verification is required when OCR is uncertain, and customer-facing grade display is conditional on verified/non-expired status.

Potentially novel combination:

- per-food-truck sanitation grade,
- OCR grade extraction,
- read-only post-save state,
- admin verification fallback,
- expiration-driven compliance scoring,
- customer display only when verified and applicable.

### 4.3 Event Source-to-Pay with Compliance-Aware Vendor Eligibility

An Event Source-to-Pay workflow where vendor ability to apply, bid, or be awarded can depend on compliance state, required document status, payment flow, and event-specific participation rules.

Potentially novel combination:

- event coordinator-managed Source-to-Pay workflow,
- vendor bid/application workflow,
- compliance document requirements,
- OCR moderation,
- award/payment state,
- not-selected/closed-event notifications,
- vendor-facing action alerts.

### 4.4 Vendor Operations ERP Integrated with Public Discovery

A system combining customer food truck discovery/order placement with vendor ERP functions such as employees, earnings, compliance, truck units, locations, event applications, and Event Source-to-Pay participation.

Potentially novel combination:

- public consumer discovery,
- vendor operational dashboard,
- staff management,
- compliance document lifecycle,
- Event Source-to-Pay participation,
- earnings calculations,
- location/order availability.

### 4.5 Notification State Tied to Event Source-to-Pay Action Events

A notification system where derived Event Source-to-Pay states such as awards, payment due, revision requested, not selected, closed event, and unread coordinator response are presented as actionable vendor alerts and cleared upon viewing.

This may be more likely a product workflow than patentable subject matter by itself, but counsel can evaluate.

## 5. Technical Workflow Examples

### 5.1 OCR Submission Moderation

```text
Vendor uploads event photo/menu/document
  -> Backend stores file metadata
  -> OCR extracts text/objects
  -> Moderation checks for contact/social/payment patterns
  -> If prohibited content found: reject/block or route to admin
  -> If clean: attach file to Event Source-to-Pay application
  -> Coordinator reviews platform-safe submission
```

### 5.2 Sanitation Grade Verification

```text
Vendor selects food truck
  -> Uploads sanitation grade document
  -> Enters expiration date
  -> Saves and runs OCR
  -> OCR attempts grade extraction
  -> If grade detected: store extracted grade for review/verification
  -> If grade not detected: keep pending admin verification
  -> Once verified: grade is read-only
  -> Customer app displays grade next to reviews only if verified and active
  -> If document expires: compliance score updates
```

### 5.3 Event Source-to-Pay Vendor Event Flow

```text
Coordinator creates event
  -> Vendors browse open events
  -> Vendor submits application/bid with required docs/photos
  -> OCR/compliance policies evaluate submission
  -> Coordinator reviews and messages vendor
  -> Vendor receives unread/action notification
  -> Coordinator accepts/awards or marks not selected
  -> Vendor pays fee if required
  -> Event closes and notifications update
```

## 6. Possible Claim Themes for Attorney Review

The attorney may consider claims around:

- A computer-implemented method for OCR-based moderation of food truck Event Source-to-Pay submissions.
- A system for conditionally publishing sanitation grade indicators based on OCR/admin verification and expiration state.
- A compliance-aware Event Source-to-Pay workflow for mobile food vendors.
- A vendor ERP platform integrated with public food truck discovery and Event Source-to-Pay operations.
- A method of preventing off-platform contact in food vendor event applications using OCR and rule-based moderation.

## 7. Differentiators to Discuss

- Food-truck-specific rather than generic restaurant/vendor management.
- Event coordinator Source-to-Pay and vendor application workflow.
- OCR checks for contact/social/payment information in uploaded food/menu images.
- Sanitation grade verification tied to food truck, not just vendor account.
- Customer-facing sanitation grade only when verified and non-expired.
- Compliance score updates based on expiration.
- Integrated customer discovery, vendor operations, event applications, and admin review.

## 8. Questions for Patent Attorney

- Which parts are potentially patentable versus better protected as trade secrets?
- Should the filing focus on OCR moderation, sanitation grade verification, Event Source-to-Pay compliance gating, or the combined system?
- Is a provisional patent application appropriate before public demos, app store launch, or investor conversations?
- Who are the inventors based on contribution to the claimed concepts?
- What prior art search should be performed?
- How should screenshots, flow diagrams, source commits, and product notes be preserved?
- Are trademarks needed for "Round Da' Corner", "RDC", or related branding?
- Are there copyright considerations for generated artwork, logos, and app screen designs?

## 9. Materials to Bring to Attorney

- This brief.
- Screenshots of customer app, vendor app, admin portal, compliance screen, Event Source-to-Pay application, and OCR flow.
- Flow diagrams for upload/OCR/moderation and sanitation grade verification.
- Timeline of development and public disclosures.
- List of contributors/inventors.
- Git commit history showing implementation dates.
- Any pitch deck, app store listing, demos, or public website links.
- Notes on competitors or similar apps.

## 10. Disclosure Timeline Template

Fill this out before the attorney meeting:

| Event | Date | Notes |
| --- | --- | --- |
| First idea documented | TBD | |
| First prototype built | TBD | |
| OCR/compliance concept added | TBD | |
| Sanitation grade verification concept added | TBD | |
| First public demo | TBD | |
| First customer/vendor test | TBD | |
| App store submission | TBD | |
| Investor/customer presentation | TBD | |

## 11. Confidentiality Reminder

Before filing, avoid public disclosure of implementation details unless counsel confirms strategy. Use NDAs where appropriate for investor, vendor, or partner discussions.
