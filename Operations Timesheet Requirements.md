# Client Requirements Document
## Employee Timesheet Management System (ETMS)

---

| Field | Details |
|---|---|
| **Document Version** | 1.0 |
| **Date** | April 2026 |
| **Client / End-User** | Operations Team, Algoleap Technologies |
| **End Client** | CBRE (Corporate client receiving timesheets for billing) |
| **Vendor / Developer** | Internal Development Team |
| **Status** | Final |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Objectives](#2-project-objectives)
3. [Stakeholders](#3-stakeholders)
4. [Current Workflow (As-Is)](#4-current-workflow-as-is)
5. [Proposed Workflow (To-Be)](#5-proposed-workflow-to-be)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Data Model & Key Entities](#8-data-model--key-entities)
9. [UI/UX Requirements](#9-uiux-requirements)
10. [Constraints & Assumptions](#10-constraints--assumptions)
11. [Acceptance Criteria](#11-acceptance-criteria)
12. [Glossary](#12-glossary)

---

## 1. Executive Summary

Algoleap Technologies deploys a team of resources to work at CBRE client locations. Every month, each resource submits a timesheet (in Excel format) to the Algoleap Operations team via email. The Operations team manually reviews each timesheet, consolidates the data, and forwards it to CBRE for billing approval. CBRE replies with an approval email.

This entire process is currently **manual, error-prone, and time-consuming**. The goal of this project is to build a **web-based Employee Timesheet Management System (ETMS)** that:

- **Automatically ingests** timesheet emails from employees.
- **Parses and stores** attendance data in a central database.
- **Provides a dashboard** for Operations to view, verify, and edit timesheet data.
- **Automatically forwards** the consolidated timesheet to CBRE.
- **Tracks the approval status** of each submission.

---

## 2. Project Objectives

| # | Objective |
|---|---|
| 1 | Eliminate manual email monitoring by automatically reading incoming timesheet emails. |
| 2 | Parse Excel-format timesheets and store data in a structured database. |
| 3 | Provide a web dashboard for Operations to view and manage monthly employee timesheets. |
| 4 | Enforce leave quota rules (max 3 Paid Leaves per quarter) automatically. |
| 5 | Generate a consolidated PO Sheet with billing calculations per employee per month. |
| 6 | Allow Operations to send consolidated timesheets to CBRE via the system dashboard with one click. |
| 7 | Track which timesheets have been received, verified, sent to CBRE, and approved. |
| 8 | Maintain an audit log of all automated actions. |

---

## 3. Stakeholders

| Role | Person / Team | Responsibilities |
|---|---|---|
| **Operations Executive** | Algoleap Ops Team | Primary user of the dashboard; verifies timesheets, triggers email to CBRE. |
| **Employees / Resources** | CBRE-deployed staff | Submit their monthly timesheet to the Operations email before the monthly deadline. |
| **CBRE Finance / IDC Leader** | CBRE Team | Receives consolidated timesheet, reviews, and replies with approval. |
| **IT / Developer** | Development Team | Builds and maintains the ETMS system. |
| **Management** | Algoleap Leadership | Views billing summaries and monthly performance reports. |

---

## 4. Current Workflow (As-Is)

```
Employee
  |
  |  (Emails Excel timesheet to ops@algoleap.com)
  v
Operations Inbox (Manual)
  |
  |  1. Manually opens each email
  |  2. Downloads attached Excel file
  |  3. Manually copies data into a master sheet
  |  4. Verifies hours, dates, and leave entries
  |
  v
Operations Review (Manual)
  |
  |  5. Manually creates consolidated PO sheet for the month
  |  6. Calculates billing amount per employee
  |
  v
Email to CBRE (Manual)
  |
  |  7. Manually composes email with attachment
  |  8. Sends consolidated sheet to CBRE contact
  |
  v
CBRE Approval (Manual Tracking)
  |
  |  9. Waits for approval reply email
  | 10. Manually marks approval status in spreadsheet
```

**Pain Points of the Current Process:**
- High manual effort — Operations handles 20+ employee emails every month.
- Risk of copy-paste errors when consolidating data.
- No centralized record of approval status.
- Leave quota errors (e.g., more than 3 PLs approved in a quarter).
- No audit trail for who changed what data and when.

---

## 5. Proposed Workflow (To-Be)

```
Employee
  |
  |  (Emails Excel timesheet to ops@algoleap.com)
  v
ETMS — Automated Email Ingestion (Every 2 minutes)
  |
  |  1. System polls the Operations Outlook inbox
  |  2. Detects new timesheet emails
  |  3. Downloads and queues the attachment for processing
  |  4. Logs the ingestion event
  |
  v
ETMS — Background Processor (Every 30 seconds)
  |
  |  5. Parses the Excel file (reads dates, hours, leave types)
  |  6. Upserts employee & attendance data into the database
  |  7. Marks log entry as 'completed' or 'failed'
  |
  v
Operations Dashboard (Web UI)
  |
  |  8. Ops team selects Month & Year
  |  9. Sees all employees with data for that month
  | 10. Reviews/edits attendance, leave counts, billing info
  | 11. Adds PO details (Invoice No, PO Number, Rate/Hour, GST%)
  | 12. Clicks "Send Email" to email CBRE automatically
  |
  v
CBRE Receives Consolidated Timesheet Email
  |
  | 13. CBRE reviews and replies with approval
  |
  v
Ops marks "Approvals = Yes" in PO Sheet dashboard
```

---

## 6. Functional Requirements

### 6.1 Email Ingestion & Automation

| ID | Requirement |
|---|---|
| FR-01 | The system SHALL automatically poll the Operations Outlook inbox every **2 minutes** using the Microsoft Graph API / OAuth2 refresh token. |
| FR-02 | The system SHALL detect emails with Excel (`.xlsx` / `.xls`) attachments that match a timesheet pattern. |
| FR-03 | Detected attachments SHALL be downloaded and stored temporarily for processing. |
| FR-04 | Each detected email SHALL be logged in the database with status: `pending`. |
| FR-05 | Already-processed emails SHALL NOT be re-ingested (idempotent processing). |
| FR-06 | A background processor SHALL run every **30 seconds**, pick up `pending` logs, parse the Excel file, and update the database. |
| FR-07 | On successful parsing, the log status SHALL change to `completed`. On failure, it SHALL change to `failed` with an error message. |

### 6.2 TimeSheet Management

| ID | Requirement |
|---|---|
| FR-08 | Operations SHALL be able to select a **Month** and **Year** to view the TimeSheet dashboard. |
| FR-09 | The dashboard SHALL display ONLY employees who have at least one attendance record for the selected month. |
| FR-10 | The TimeSheet table SHALL show fixed columns: Employee Name, Employee ID, Joining Date, Reporting Manager, D&T Leader, Client, Billing Category, Month. |
| FR-11 | The TimeSheet table SHALL display one column per calendar day of the selected month with the day name shown (Mon, Tue…). |
| FR-12 | Each date cell SHALL be **inline-editable**. Operations can type: numeric hours (e.g., `8`, `8.5`), `PL`, `LWP`, `WFH`, or `-`. |
| FR-13 | The system SHALL display auto-computed columns: **Total Working Hours**, **PL Availed**, **LWP**, **Total Billing Hours**. |
| FR-14 | Operations SHALL be able to **add a new employee row**. New rows SHALL default the Client field to `CBRE`. |
| FR-15 | Employee ID SHALL be editable for newly added rows UNTIL the row is saved. After saving, Employee ID SHALL be read-only. |
| FR-16 | Each row SHALL have a **Save button**. Data SHALL be persisted to the database only when Save is clicked. |
| FR-17 | Each row SHALL have a **Delete button**. Clicking it SHALL show a confirmation dialog before permanently removing the record and all associated attendance from the database. |
| FR-18 | The dashboard SHALL have a **Download Sheet** button exporting visible data as a styled Excel file. |
| FR-19 | The dashboard SHALL have a **Send Email** button sending the consolidated timesheet as an Excel attachment to the CBRE recipient. |
| FR-20 | The system SHALL display a checkbox per row; only checked rows are included in exports and emails. |

### 6.3 Leave & PL (Paid Leave) Management

> **CRITICAL:** The leave quota rule is the core business logic. It MUST be implemented identically in both the TimeSheet and PO Sheet views.

| ID | Requirement |
|---|---|
| FR-21 | Each employee is entitled to a maximum of **3 Paid Leaves (PLs) per quarter**. |
| FR-22 | Quarters follow Indian FY: **Q1** = Apr–Jun, **Q2** = Jul–Sep, **Q3** = Oct–Dec, **Q4** = Jan–Mar. |
| FR-23 | When computing PL for a month, the system SHALL check PLs already used in **prior months of the same quarter**. |
| FR-24 | `remaining_quota = max(0, 3 – PLs_used_in_previous_quarter_months)` |
| FR-25 | `paid_PL_this_month = min(raw_PL_count_this_month, remaining_quota)` |
| FR-26 | PLs in excess of the quota SHALL be automatically classified as **LWP**. |
| FR-27 | In the date grid, when quota is exhausted, any cell typed as `PL` SHALL display as `LWP` automatically. |
| FR-28 | `Total Billing Hours = Total Working Hours + (Paid PL x 8 hours)`. LWP days are NOT added to billing hours. |
| FR-29 | PL Availed and Total Billing Hours SHALL be **identical** in both TimeSheet and PO Sheet for the same employee/month. |

### 6.4 PO Sheet Management

| ID | Requirement |
|---|---|
| FR-30 | A **PO Sheet** section SHALL exist on the dashboard, below the TimeSheet. |
| FR-31 | The PO Sheet SHALL be linked to the TimeSheet by **Employee ID** and show the same employees for the selected month. |
| FR-32 | The PO Sheet auto-computed (read-only) columns: S.No, Resource Name, Emp ID (CBRE), Reporting Manager, Total Working Hours, PL Availed, Total Billing Hours. |
| FR-33 | The PO Sheet user-editable columns: Invoice No, PO Number, SOW No, As Per CBRE IDC Leader, Rate Per Hour (INR), GST (%), Work Location, Resource Type, Vendor Name, Notes, Exits. |
| FR-34 | The PO Sheet SHALL auto-calculate: **Total Billing Amount (W/O GST) = Total Billing Hours x Rate Per Hour**. |
| FR-35 | The PO Sheet SHALL auto-calculate: **Total Billed Amount = Billing Amount (W/O GST) + (Billing Amount x GST%)**. |
| FR-36 | The PO Sheet SHALL display dropdown status columns: Timesheet Received (Yes/No), Timesheet Verified (Yes/No), Timesheet Sent to CBRE (Yes/No), Approvals (Yes / No / Pending). |
| FR-37 | The PO Sheet SHALL display leave counts per quarter month dynamically (e.g., for Q4: Jan Leaves, Feb Leaves, Mar Leaves, Q4 Leave Balance). |
| FR-38 | `Q Leave Balance = max(0, 3 – total PLs across the three quarter months)`. |
| FR-39 | A `[Month] Leave Dates` column SHALL list specific dates where PL was taken (e.g., "Mar: 05, 12"). |
| FR-40 | Vendor Name SHALL default to `Algoleap`. |
| FR-41 | Each PO Sheet row SHALL have a **Save button** persisting only the PO-specific editable fields. |

### 6.5 Email Forwarding & Approval Tracking

| ID | Requirement |
|---|---|
| FR-42 | The Operations team SHALL send the consolidated Excel to CBRE via the **Send Email** button in the TimeSheet section. |
| FR-43 | Email subject format: `Timesheet of [Month] [Year]`. |
| FR-44 | The attached Excel SHALL be styled with Algoleap branding (green header, zebra-striped rows, borders). |
| FR-45 | After receiving CBRE approval, Operations manually updates "Timesheet Sent to CBRE" and "Approvals" in the PO Sheet. |

### 6.6 Automation Logs

| ID | Requirement |
|---|---|
| FR-46 | The dashboard SHALL display an **Automation Logs** section showing all email ingestion/processing events. |
| FR-47 | Each log entry SHALL show: ID, File Name, Status, Created At timestamp. |
| FR-48 | Log statuses SHALL be color-coded: green = completed, yellow = pending, blue = processing, red = failed. |
| FR-49 | The section SHALL show a **live backend status badge** (Online / Offline). |
| FR-50 | Logs SHALL auto-refresh every **10 seconds** without a page reload. |

---

## 7. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | **Performance** | Dashboard SHALL load timesheet data for a given month within 3 seconds under normal conditions. |
| NFR-02 | **Reliability** | Email ingestion worker SHALL run continuously. Failures in one cycle SHALL not crash the server; the next cycle SHALL retry. |
| NFR-03 | **Security** | OAuth2 tokens for Outlook SHALL be stored in environment variables, never in source code. |
| NFR-04 | **Data Integrity** | Saving a row SHALL use upsert keyed on `employee_id`. No duplicate records for same employee/month. |
| NFR-05 | **Consistency** | PL Availed and Total Billing Hours values SHALL use identical calculation logic in both TimeSheet and PO Sheet. |
| NFR-06 | **Usability** | Web interface SHALL be usable on modern desktop browsers (Chrome, Edge). Mobile support is out of scope. |
| NFR-07 | **Maintainability** | Backend and frontend SHALL be in separate directories with clear separation of concerns. |
| NFR-08 | **Scalability** | System SHALL support up to 100 employees without performance degradation. |

---

## 8. Data Model & Key Entities

### 8.1 `employees` Table

| Column | Type | Description |
|---|---|---|
| `employee_id` | VARCHAR (PK) | Unique employee identifier (CBRE-issued ID). |
| `employee_name` | VARCHAR | Full name of the resource. |
| `joining_date` | DATE | Date of joining. |
| `reporting_manager` | VARCHAR | Algoleap reporting manager name. |
| `dt_leader` | VARCHAR | CBRE D&T Leader assigned to this resource. |
| `client` | VARCHAR | Client name (default: `CBRE`). |

### 8.2 `attendance` Table

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL (PK) | Auto-incrementing ID. |
| `employee_id` | VARCHAR (FK) | Links to employees table. |
| `date` | DATE | The specific calendar date. |
| `day` | VARCHAR | Day abbreviation (Mon, Tue…). |
| `working_hours` | VARCHAR | Value: numeric hours, `PL`, `LWP`, `WFH`, `-`, etc. |

**Unique constraint:** `(employee_id, date)`

### 8.3 `po_sheet` Table

| Column | Type | Description |
|---|---|---|
| `employee_id` | VARCHAR (FK) | Links to employees table. |
| `year` | INTEGER | Calendar year. |
| `month` | INTEGER | Month number (1–12). |
| `invoice_no` | VARCHAR | Invoice number for the billing cycle. |
| `po_number` | VARCHAR | Purchase Order number from CBRE. |
| `sow_no` | VARCHAR | Statement of Work number. |
| `cbre_idc_leader` | VARCHAR | CBRE IDC Leader name. |
| `rate_per_hour` | NUMERIC | Billing rate per hour in INR. |
| `gst` | NUMERIC | GST percentage (e.g., 18.00). |
| `timesheet_received` | VARCHAR | Yes / No. |
| `timesheet_verified` | VARCHAR | Yes / No. |
| `timesheet_sent_to_cbre` | VARCHAR | Yes / No. |
| `approvals` | VARCHAR | Yes / No / Pending. |
| `notes` | TEXT | Additional notes. |
| `work_location` | VARCHAR | On-site / Remote / Hybrid. |
| `resource_type` | VARCHAR | Full-Time / Contract etc. |
| `vendor_name` | VARCHAR | Default: `Algoleap`. |
| `exits` | VARCHAR | Exit date or reason if resource has left. |

**Unique constraint:** `(employee_id, year, month)`

### 8.4 `timesheet_logs` Table

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL (PK) | Auto-incrementing ID. |
| `extracted_timesheet_filename` | VARCHAR | Original filename of the email attachment. |
| `status` | VARCHAR | `pending`, `processing`, `completed`, `failed`. |
| `error_message` | TEXT | Error details if status is `failed`. |
| `created_at` | TIMESTAMPTZ | Timestamp when the email was ingested. |

---

## 9. UI/UX Requirements

| ID | Requirement |
|---|---|
| UX-01 | The application SHALL use a **dark-themed, modern design** with Algoleap green (`#3C874B`) as the primary accent color. |
| UX-02 | The TimeSheet table SHALL be **horizontally scrollable** to accommodate up to 31 date columns plus fixed info columns. |
| UX-03 | Computed (read-only) columns SHALL be visually distinct from user-editable columns. |
| UX-04 | Newly added unsaved rows SHALL show a **dashed border** on the Employee ID cell to indicate it is editable. |
| UX-05 | The Delete confirmation dialog SHALL clearly state that the action is **permanent**. |
| UX-06 | The Automation Logs section SHALL show a **live Online/Offline badge** with periodic health-check pings. |
| UX-07 | Monetary values in the PO Sheet SHALL be formatted in **Indian Rupee (INR)** with 2 decimal places. |
| UX-08 | Leave balance columns SHALL turn **red** when the balance reaches zero. |

---

## 10. Constraints & Assumptions

| # | Constraint / Assumption |
|---|---|
| C-01 | Operations team uses **Microsoft Outlook** exclusively. Gmail is out of scope. |
| C-02 | Employees submit timesheets as **.xlsx files** only. PDFs or images are out of scope. |
| C-03 | Leave quarters follow **Indian FY**: Q1 = Apr–Jun, Q2 = Jul–Sep, Q3 = Oct–Dec, Q4 = Jan–Mar. |
| C-04 | Maximum Paid Leaves per quarter = **3**. This is a fixed business rule, not configurable via UI. |
| C-05 | One working day = **8 hours** for PL billing calculations. |
| C-06 | All resources are billed to **CBRE** only. Multi-client support is out of scope. |
| C-07 | The system is for **internal Operations team use only**. No employee-facing portal required. |
| C-08 | Database is hosted on **Supabase** (PostgreSQL). Schema changes are applied via the Supabase SQL Editor. |
| C-09 | The system handles timesheet tracking and billing calculation only. It does **NOT** handle payroll. |

---

## 11. Acceptance Criteria

### Email Automation
- [ ] System detects a new timesheet email within 2 minutes of arrival.
- [ ] Attachment is parsed and employee/attendance data appears in the dashboard.
- [ ] Duplicate emails are NOT re-processed.
- [ ] A log entry appears in Automation Logs with the correct status.

### TimeSheet Dashboard
- [ ] Selecting a month/year shows only employees with data in that period.
- [ ] Date columns correctly reflect the number of days in the selected month.
- [ ] Editing a cell and clicking Save persists the change to the database.
- [ ] Adding a new row defaults Client to "CBRE" and Employee ID is editable until saved.
- [ ] Deleting a row shows a confirmation and removes all records permanently.

### Leave Logic
- [ ] After 3 PLs in a quarter, further PL entries automatically display as LWP.
- [ ] Total Billing Hours = Numeric hours + (Paid PL count x 8).
- [ ] PL Availed values are **identical** in TimeSheet and PO Sheet for the same employee/month.

### PO Sheet
- [ ] Total Billing Amount (W/O GST) = Total Billing Hours x Rate Per Hour.
- [ ] Total Billed Amount = Billing Amount + GST amount.
- [ ] Quarter leave columns dynamically show the 3 months of the current quarter.
- [ ] Saving a PO Sheet row persists only PO-specific editable fields.

### Email to CBRE
- [ ] Clicking "Send Email" sends an email with the correct subject and styled Excel attachment.
- [ ] Only rows with checkboxes selected are included in the exported/emailed file.

---

## 12. Glossary

| Term | Definition |
|---|---|
| **PL** | Paid Leave — a leave day that counts toward billing hours (employee is paid, CBRE is billed). |
| **LWP** | Leave Without Pay — a leave day that does NOT count toward billing hours. |
| **PO** | Purchase Order — a formal document from CBRE authorizing billing for services. |
| **SOW** | Statement of Work — defines scope, deliverables, and billing terms. |
| **Quarter** | A 3-month period within the Indian fiscal year (Apr–Mar). |
| **Billing Hours** | Hours billed to CBRE = Working Hours + (Paid PL x 8). |
| **IDC Leader** | Innovation and Digital Centre Leader — CBRE point of contact who approves timesheets. |
| **Upsert** | A database operation: inserts if record does not exist, updates if it does. |
| **Operations Inbox** | Algoleap Outlook mailbox that receives employee timesheets each month. |

---

*Document prepared based on the operational workflow of Algoleap Technologies for the CBRE engagement.*
*All business rules described herein are as communicated by the Operations team.*
