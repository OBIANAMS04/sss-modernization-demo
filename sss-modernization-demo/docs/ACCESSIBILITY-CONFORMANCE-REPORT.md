# Accessibility Conformance Report (VPAT® 2.5, WCAG edition, with Revised Section 508): STORY-042

Demonstrated on a synthetic demo deployment; not operating in production. This report describes the demo, not a delivered product.

| | |
|---|---|
| **Name of product** | SSS Modernization Demo (web application): https://sss-demo-frontend.onrender.com |
| **Version** | Commit `ba6257c` and later (2026-10-21) |
| **Report date** | 2026-10-21 |
| **Contact** | Obi Anamelechi Kingsley, Colaberry |
| **Product description** | Registration, two-step sign-in, profile and exemption eligibility, applications and appeals, case management, compliance, audit, dashboards for four roles, a policy assistant, and staff tools (AI quality, observability, access policies) |
| **Evaluation methods** | (1) An automated audit in Chrome of every page for every role (`scripts/a11y/audit.mjs`): axe-core 4.10.2 with all WCAG 2.0 and 2.1 A and AA rules; keyboard (Tab reaches every control, nothing traps focus, a visible focus indicator at each stop); page title, one h1, one main landmark and a skip link; reflow at 320 CSS pixels; forms after a failed submit (errors announced or fields marked invalid and described, focus on the first); the session-timeout warning. 40 checks on the local stack (`docs/evidence/r3-m2-a11y/`) and the signed-out and applicant pages on the live demo (`docs/evidence/r3-m2-a11y-live/`), all passing. The recovery-code views added on 2026-10-21 (codes shown once, and the recovery mode of the code page) were exercised by the evidence run (`docs/evidence/r3-m2/`) but are not yet in the automated audit. (2) Manual review of colour contrast, the confirmation steps, the charts and their tables. **Not yet done:** a hands-on test with screen readers (JAWS, NVDA, VoiceOver, TalkBack) and with screen magnification and speech input, and a test with people with disabilities. Where a criterion depends on how assistive technology announces something, the remark says so |
| **Standards** | WCAG 2.1 Level A and AA; Revised Section 508 (36 CFR 1194), which incorporates WCAG 2.0 A and AA for web content |

## Terms

- **Supports:** the functionality meets the criterion without known defects.
- **Partially Supports:** some functionality does not meet the criterion.
- **Does Not Support:** the majority of functionality does not meet the criterion.
- **Not Applicable:** the criterion is not relevant to the product.

## Table 1: WCAG 2.1 Level A

| Criterion | Conformance | Remarks |
|---|---|---|
| 1.1.1 Non-text Content | Supports | Images have text alternatives (the MFA QR code is described and its setup key is shown as text). Charts are `role="img"` with a name and a table of the same numbers below. Icons that carry no meaning are hidden from assistive technology |
| 1.2.1 Audio-only and Video-only (Prerecorded) | Not Applicable | No audio or video |
| 1.2.2 Captions (Prerecorded) | Not Applicable | No audio or video |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | Not Applicable | No video |
| 1.3.1 Info and Relationships | Supports | Headings, landmarks, lists, tables with header cells, labelled fields and grouped options, checked by axe on every page. Screen-reader confirmation outstanding |
| 1.3.2 Meaningful Sequence | Supports | Reading order follows the visual order (single-column source order, no CSS reordering of content) |
| 1.3.3 Sensory Characteristics | Supports | Instructions name fields and buttons by their labels, not by shape, colour or position |
| 1.4.1 Use of Color | Supports | Status is written in words as well as colour (badges, freshness level, alerts); chart series also differ in line style and markers; links in text are underlined |
| 1.4.2 Audio Control | Not Applicable | No audio |
| 2.1.1 Keyboard | Supports | Every control is reached and operated by keyboard (audited on every page and role) |
| 2.1.2 No Keyboard Trap | Supports | No trap found; the session-timeout dialog keeps focus inside on purpose and closes with Escape |
| 2.1.4 Character Key Shortcuts | Not Applicable | No single-character shortcuts |
| 2.2.1 Timing Adjustable | Partially Supports | Sessions: a warning two minutes before the end with **Stay signed in** (Escape also extends), up to 12 hours (tested). **Exception:** the two-step code page ends 5 minutes after the password step without a warning; the person returns to the password step with a message and loses nothing else. The limit protects the account; a warning with an extension is planned |
| 2.2.2 Pause, Stop, Hide | Supports | No auto-moving or blinking content. Loading spinners show only while a request is in progress. The data-status card and AI Quality refresh their numbers without moving content |
| 2.3.1 Three Flashes or Below Threshold | Supports | Nothing flashes |
| 2.4.1 Bypass Blocks | Supports | **Skip to main content** is the first Tab stop on every signed-in page; every page has a main landmark |
| 2.4.2 Page Titled | Supports | Every screen sets its own title ("Case Management · SSS Modernization Demo") |
| 2.4.3 Focus Order | Supports | Focus follows reading order; dialogs and new sections receive focus, and focus returns when they close |
| 2.4.4 Link Purpose (In Context) | Supports | Link text names its destination |
| 2.5.1 Pointer Gestures | Supports | Single-pointer actions only |
| 2.5.2 Pointer Cancellation | Supports | Native buttons and links (action on release) |
| 2.5.3 Label in Name | Supports | Accessible names begin with the visible label (axe check) |
| 2.5.4 Motion Actuation | Not Applicable | No motion-operated functions |
| 3.1.1 Language of Page | Supports | `lang="en"` |
| 3.2.1 On Focus | Supports | Focus never submits or navigates |
| 3.2.2 On Input | Supports | Changing a field or filter does not submit a form; case filters update the list in place and are kept in the address |
| 3.3.1 Error Identification | Supports | After a failed submit each invalid field is marked and described by its message, or the message is announced; focus moves to the first (tested on every form) |
| 3.3.2 Labels or Instructions | Supports | Every field has a visible label and, where a format is needed, a hint (SSN, date, code, recovery code) |
| 4.1.1 Parsing | Supports | Markup generated by React; no duplicate ids found (removed from WCAG 2.2) |
| 4.1.2 Name, Role, Value | Supports | Native controls throughout; custom parts (the session dialog, show and hide buttons, expanding citations) carry roles, names and states (axe). Screen-reader confirmation outstanding |

## Table 2: WCAG 2.1 Level AA

| Criterion | Conformance | Remarks |
|---|---|---|
| 1.2.4 Captions (Live) | Not Applicable | No live media |
| 1.2.5 Audio Description (Prerecorded) | Not Applicable | No video |
| 1.3.4 Orientation | Supports | Works in portrait and landscape; nothing is locked |
| 1.3.5 Identify Input Purpose | Supports | `autocomplete` on personal fields: email, name, bday, tel, street-address, new-password, current-password, one-time-code |
| 1.4.3 Contrast (Minimum) | Supports | Text at 4.5:1 or more (axe on every page; chart colours chosen at 4.5:1 or more on white) |
| 1.4.4 Resize Text | Supports | Text sizes in rem; content reflows (see 1.4.10) |
| 1.4.5 Images of Text | Supports | No images of text (the QR code is not text, and its key is shown as text) |
| 1.4.10 Reflow | Supports | No sideways scrolling at 320 CSS pixels on any page; wide tables scroll inside their own box (tested) |
| 1.4.11 Non-text Contrast | Supports | Field borders 4.8:1; focus ring and chart lines 3:1 or more |
| 1.4.12 Text Spacing | Supports | No fixed-height text containers; checked by axe's spacing rules. Not tested with a spacing bookmarklet on every page |
| 1.4.13 Content on Hover or Focus | Not Applicable | No content appears on hover or focus apart from native browser tooltips |
| 2.4.5 Multiple Ways | Supports | The top navigation reaches every page a role can open; dashboards link to the lists; case filters open a filtered list from its address |
| 2.4.6 Headings and Labels | Supports | Headings and labels describe topic or purpose |
| 2.4.7 Focus Visible | Supports | A visible focus indicator at every Tab stop (tested) |
| 3.1.2 Language of Parts | Supports | All content is English |
| 3.2.3 Consistent Navigation | Supports | One navigation bar in the same order on every page |
| 3.2.4 Consistent Identification | Supports | The same functions have the same names throughout |
| 3.3.3 Error Suggestion | Supports | Messages say what is needed ("Enter the 6-digit code from your authenticator app", the password rules, the SSN format) |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Supports | Applications and appeals are confirmed before they are sent; decisions need a reason; staff role changes need a reason and can be reversed |
| 4.1.3 Status Messages | Supports | Success and progress messages use `role="status"`, errors `role="alert"`; screen-reader confirmation outstanding |

## Table 3: Revised Section 508

| Section | Conformance | Remarks |
|---|---|---|
| Chapter 3: Functional Performance Criteria (302.1 without vision to 302.9 with limited language, cognitive and learning abilities) | Partially Supports | Designed and tested for keyboard, contrast, reflow and plain language; without a hands-on screen-reader and magnification test, use without vision and with limited vision is supported by design and automated checks but not yet confirmed. 302.2 (limited vision) is also helped by 200% zoom and reflow. 302.5 to 302.6 (hearing, speech): no audio, no speech input needed |
| Chapter 4: Hardware | Not Applicable | Web application |
| Chapter 5: Software (501 to 504) | Not Applicable | Web content is covered by Chapter 3 and WCAG; the product includes no authoring tool |
| Chapter 6: Support Documentation and Services (602, 603) | Supports | User, administrator and operator guides (`docs/USER-GUIDE.md`, `ADMIN-GUIDE.md`, `OPERATOR-RUNBOOK.md`) describe the accessibility features in Markdown, which renders as accessible HTML. 603 support services are a demo limit: there is no help desk |

## Legal disclaimer and what remains

This report is our own assessment of a demonstration, prepared in the VPAT 2.5 format ("VPAT" is a registered service mark of the
Information Technology Industry Council). Before production: a hands-on test with JAWS, NVDA, VoiceOver and TalkBack, with
magnification and speech input, and by people with disabilities; an independent review of this report; the two-step timing
warning (2.2.1); and the same audit run before every release (today it is run by hand, not in a build pipeline).
