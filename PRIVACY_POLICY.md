# Privacy Policy — DC Collection Tool (Chrome Extension)

**Effective Date:** June 2026  
**Last Updated:** June 2026  
**Contact:** thawatchai.man@monee.com · oabnithi.bur@monee.com

---

## Overview

The **DC Collection Tool** is a Chrome Extension developed and operated by **Monee** for exclusive use by authorized Monee employees. This extension is not available to the general public. By using this extension, you acknowledge that you are an authorized Monee employee and agree to this policy.

---

## 1. Information We Collect

### 1.1 Google Account Information
- **Google account email address** — collected via Google OAuth 2.0 solely to authenticate the user and verify that they are an authorized Monee employee. No other Google account data (e.g., profile photo, contacts, Drive files) is accessed.

### 1.2 Collection Activity Data
Data entered by the agent during debt collection activity, including but not limited to:
- Case IDs
- Payment amounts
- Call details and notes
- Partial payment records

This data is submitted exclusively to **Monee's internal Google Sheets** via Google Apps Script.

---

## 2. How We Use Your Information

| Data | Purpose |
|------|---------|
| Google email | Authentication & access control (employees only) |
| Collection activity data | Recording and reporting to internal Google Sheets |
| Cached session data | Maintaining session state within Chrome; not transmitted externally |

We do **not** use any collected data for advertising, profiling, analytics services, or any purpose outside of Monee's internal debt collection operations.

---

## 3. Data Storage

| Location | Type | Retention |
|----------|------|-----------|
| Monee's internal Google Sheets | Collection activity data | Per Monee's internal data retention policy |
| `chrome.storage.local` | Session cache (e.g., auth token, active case) | Cleared on logout or session expiry |

No data is stored on any external server or third-party cloud platform outside of Google services already used by Monee (Google Workspace / Google Apps Script).

---

## 4. Data Sharing

**We do not share any data with third parties.**

- Data collected by this extension is accessible only to authorized Monee personnel.
- No data is sold, rented, or traded.
- No analytics or tracking SDKs (e.g., Google Analytics, Mixpanel) are embedded in this extension.

---

## 5. Third-Party Services

This extension communicates only with the following services, all of which are internal or operated by Monee:

| Service | Purpose |
|---------|---------|
| `script.google.com` / `script.googleusercontent.com` | Google Apps Script (internal backend) |
| `www.googleapis.com` | Google OAuth 2.0 authentication |
| `collections.scredit.in.th` | Monee's internal collections platform (content injection target) |
| `api.ipify.org` | IP address lookup (used for session/logging purposes only) |

---

## 6. Permissions Used

This extension requests the following Chrome permissions:

| Permission | Reason |
|-----------|--------|
| `identity` | Google OAuth 2.0 login |
| `storage` | Local session cache |
| `activeTab` / `scripting` / `tabs` | Inject UI into the collections platform |
| `alarms` | Session timeout management |

---

## 7. Children's Privacy

This extension is restricted to authorized adult employees of Monee and is not directed to or intended for use by minors.

---

## 8. Security

We take reasonable technical and organizational measures to protect data transmitted through this extension. All communication with Google Apps Script endpoints uses HTTPS. Authentication is enforced via Google OAuth 2.0, and access is limited to a pre-approved list of Monee employee accounts.

---

## 9. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be reflected by updating the **Last Updated** date above. Continued use of the extension after an update constitutes acceptance of the revised policy.

---

## 10. Contact Us

For questions or concerns about this Privacy Policy, please contact:

**Monee — DC Collection Tool Team**  
📧 thawatchai.man@monee.com  
📧 oabnithi.bur@monee.com
