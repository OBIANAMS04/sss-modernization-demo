# #43: FAQ & Knowledge Base

## Frequently Asked Questions

---

## For Citizens/Applicants

### General Questions

**Q: What is the SSS Program?**
A: The Specialized Services System (SSS) is a government program that provides financial assistance and support services to eligible individuals and families meeting specific eligibility criteria. The platform helps applicants submit cases, track status, and receive timely approvals.

**Q: How do I create an account?**
A: 
1. Visit the SSS Platform home page
2. Click "Sign Up" in the top-right corner
3. Enter your email and create a password
4. Verify your email by clicking the link sent to your inbox
5. Complete your profile with personal information
6. You're ready to submit your first case!

**Q: Is my personal information secure?**
A: Yes! We use:
- 256-bit SSL encryption for all data in transit
- AES-256 encryption for data at rest
- AWS Secrets Manager for sensitive credentials
- Regular security audits and penetration testing
- Compliance with NIST 800-53 and FAR 52.209-2 standards

**Q: What should I do if I forget my password?**
A:
1. Click "Forgot Password" on the login page
2. Enter your email address
3. Click the reset link in the email sent to you
4. Create a new password
5. Sign in with your new password

**Q: Can I enable two-factor authentication (2FA)?**
A: Yes! In your account settings:
1. Go to Security → Two-Factor Authentication
2. Choose TOTP (authenticator app) or SMS codes
3. Scan the QR code with your authenticator app
4. Enter the 6-digit code to confirm setup
5. Save backup codes in a safe place

### Case Submission

**Q: What information do I need to submit a case?**
A: Required information includes:
- Full legal name
- Date of birth
- Social Security Number
- Contact information (email, phone)
- Current employment status
- Annual household income
- Household size
- Supporting documents (proof of income, employment letters, etc.)

**Q: What documents do I need to upload?**
A: Required supporting documents:
- Government-issued ID (driver's license, passport)
- Proof of income (recent tax return or pay stub)
- Proof of employment (letter from employer)
- Proof of residence (utility bill, lease agreement)
- Bank statements (last 2 months)

**Q: How long does case review take?**
A: Standard review timeline:
- Initial review: 5 business days
- Verification: 3-5 business days
- Decision: Approved/Denied notification within 15 business days
- Appeal (if needed): 10 business days for appeal decision

**Q: Can I submit multiple cases?**
A: Yes, but each case must be for a different household member or a different time period. You cannot have overlapping cases for the same person.

**Q: Can I edit my case after submission?**
A: Cases can be edited within 24 hours of submission. After that, you can:
- Contact support to request an edit
- Submit a new case with updated information
- Appeal if the decision is incorrect

### Exemptions

**Q: What is an exemption?**
A: An exemption is a waiver of standard SSS eligibility requirements for specific circumstances (e.g., medical hardship, temporary income loss, etc.).

**Q: How do I request an exemption?**
A:
1. Go to Cases → Select your case
2. Click "Request Exemption"
3. Select exemption type from dropdown
4. Provide supporting documentation
5. Submit for review

**Q: What exemption types are available?**
A:
- Medical hardship (chronic illness, disability)
- Temporary income loss (job loss, reduced hours)
- Emergency situations (natural disaster, accident)
- Special circumstances (family emergency, hardship)

**Q: Can my exemption request be denied?**
A: Yes. Exemptions require:
- Clear documentation of hardship
- Explanation of why standard criteria cannot be met
- Supporting evidence from third parties when possible
- Meeting the specific exemption category requirements

**Q: Can I appeal an exemption denial?**
A: Yes! You have 30 days to:
1. Go to your case → View Decision → Appeal
2. Provide additional documentation
3. Explain why the denial was incorrect
4. Submit for appeal review (10 business days)

### Payments & Exemptions

**Q: When will I receive my approval?**
A: You'll receive notification via:
- Email (primary method)
- SMS text message (if enabled)
- In-app notification
- Printed letter (optional)

**Q: How is the exemption amount calculated?**
A: The amount depends on:
- Household size and composition
- Income level and sources
- Type of exemption granted
- Specific program guidelines
- Case complexity

**Q: Can I receive partial exemptions?**
A: Yes. Your case may qualify for:
- Full exemption (100% waiver)
- Partial exemption (50-99% waiver)
- Conditional exemption (waiver if conditions met)
- Graduated exemption (phased in over time)

---

## For Case Managers

### Account & Access

**Q: How do I log in to the case manager dashboard?**
A:
1. Visit the SSS Platform
2. Click "Log In"
3. Enter your government-issued credentials
4. Complete MFA verification (SMS or authenticator app)
5. You're in!

**Q: I lost access to my authenticator app. What do I do?**
A:
1. Contact your system administrator
2. Provide identity verification
3. Administrator resets MFA in user management
4. Set up new authenticator app or SMS method
5. Backup codes also work in emergency

**Q: What permissions do case managers have?**
A:
- View assigned cases
- Update case status
- Request additional documentation
- Approve/deny cases within assigned authority
- View audit trail of all actions
- Cannot: delete cases, access other manager's cases, modify system settings

### Case Management

**Q: How do I access my assigned cases?**
A:
1. Go to Dashboard → My Cases
2. Filter by status (pending, in-review, approved, denied)
3. Sort by submission date, priority, or deadline
4. Click case to view details

**Q: How do I request more information from applicant?**
A:
1. Open case → Documents tab
2. Click "Request More Information"
3. Specify which documents/info needed
4. Set deadline (default 10 days)
5. Applicant receives notification
6. Applicant uploads new documents
7. You receive notification when uploaded

**Q: What is the decision workflow?**
A:
1. Review all documents and information
2. Run eligibility check (automated ML prediction helps)
3. Consult guidelines for borderline cases
4. Document reasoning in decision comments
5. Click "Approve" or "Deny"
6. Add reason/explanation (required)
7. Notification automatically sent to applicant

**Q: Can I undo a decision?**
A: No, decisions are final once submitted. However:
- Applicants can appeal within 30 days
- You can contact supervisor to reopen case in rare circumstances
- Audit trail tracks all actions permanently

**Q: How do I handle appeals?**
A:
1. Go to Case → Appeals tab
2. Review appeal details and new documentation
3. Compare to original decision
4. Make new decision based on additional info
5. Document reasoning
6. Submit appeal decision
7. Process repeats if applicant appeals again

### Bulk Operations

**Q: Can I process multiple cases at once?**
A: Yes! Use Bulk Operations:
1. Select multiple cases (checkboxes)
2. Click "Bulk Actions" button
3. Choose action (update status, bulk approve, send message)
4. Confirm and submit
5. Progress tracked in "Bulk Jobs" section

**Q: How do I import cases from another system?**
A:
1. Go to Admin → Bulk Import
2. Download CSV template
3. Fill in required columns
4. Validate format before upload
5. Upload file
6. Monitor progress in Background Jobs
7. Review any import errors
8. Cases appear in dashboard once processed

**Q: Can I export case data?**
A: Yes! Export options:
1. Go to Cases → Select cases → Export
2. Choose format (CSV, Excel, PDF)
3. Choose fields to include
4. File downloads automatically
5. Comply with data protection regulations

### Reporting

**Q: How do I create a custom report?**
A:
1. Go to Reports → Create New Report
2. Select report type (cases, exemptions, performance, etc.)
3. Choose metrics to include
4. Add filters (date range, status, outcome)
5. Choose output format (PDF, CSV, Excel)
6. Schedule delivery (one-time or recurring)
7. Set up email delivery
8. Report generated and sent automatically

**Q: What reports are required for leadership?**
A:
- Weekly case processing report (Tuesday)
- Monthly exemption summary (1st of month)
- Monthly SLA/performance report (2nd of month)
- Quarterly compliance report (Jan 1, Apr 1, Jul 1, Oct 1)
- Annual audit report (Jan 31)

---

## For Administrators

### System Administration

**Q: How do I manage user accounts?**
A:
1. Go to Admin → User Management
2. Click "Add User" or search existing user
3. Enter email, name, assign role
4. Set permissions/authority level
5. Send activation email to new user
6. User completes first login setup

**Q: How do I reset a user's password?**
A:
1. Go to Admin → User Management
2. Find user in list
3. Click Actions → Reset Password
4. Temporary password sent to admin email
5. Forward to user securely
6. User changes password on first login

**Q: Can I deactivate a user account?**
A: Yes!
1. Go to Admin → User Management
2. Find user
3. Click Actions → Deactivate
4. Confirm deactivation
5. User loses access immediately
6. All sessions terminated
7. Audit log records deactivation

**Q: How do I assign roles and permissions?**
A:
- **Citizen Role:** Submit cases, view own cases, appeal decisions
- **Case Manager:** Review assigned cases, make decisions
- **Lead Manager:** Oversee team, review appeals
- **Admin:** User management, system configuration, audit logs
- **Leadership:** View dashboards, run reports, approve policies

**Q: What is role-based access control (RBAC)?**
A: RBAC ensures:
- Users only see data relevant to their role
- Actions restricted based on role permissions
- Audit trail records role-based access
- Permissions can be revoked instantly
- Separation of duties maintained

### Configuration

**Q: How do I customize email templates?**
A:
1. Go to Admin → Settings → Email Templates
2. Select template to edit (case-approved, exemption-denied, etc.)
3. Edit subject line and email body
4. Use variables like {{applicantName}}, {{caseId}}
5. Preview before saving
6. Changes apply immediately to new emails

**Q: How do I configure SMS alerts?**
A:
1. Go to Admin → Settings → SMS Configuration
2. Enter Twilio Account SID and Auth Token
3. Set phone number for SMS sender
4. Choose alert types (P0 incidents, payment confirmations)
5. Set quiet hours if needed (e.g., 22:00-06:00)
6. Test with "Send Test Message"
7. Save configuration

**Q: How do I manage feature flags?**
A:
1. Go to Admin → Feature Flags
2. View active flags (graphql-api-beta, ml-predictions, etc.)
3. Click flag to edit rollout percentage
4. Select targeting rules (by role, by plan)
5. Preview impact before deploying
6. Deploy flag changes
7. Monitor adoption in analytics

**Q: How do I configure alerting thresholds?**
A:
1. Go to Admin → Monitoring → Alert Configuration
2. Set thresholds for:
   - Error rate spike (default >5%)
   - Database latency (default >2 seconds)
   - Cache hit ratio (default <50%)
   - Disk space (default >90% full)
3. Set severity levels (P0, P1, P2)
4. Configure escalation (who gets notified, how)
5. Test alert delivery
6. Save and enable

### Monitoring & Maintenance

**Q: How do I access system logs?**
A:
1. Go to Admin → Monitoring → Logs
2. Choose log type (application, database, security, etc.)
3. Set date range
4. Search by keyword or log level (ERROR, WARN, INFO)
5. View detailed log entry with context
6. Export logs for analysis

**Q: How do I check system health?**
A:
1. Go to Admin → Monitoring → Health Dashboard
2. View component status:
   - API servers (green = healthy)
   - Database (response time + connections)
   - Cache (hit ratio, memory usage)
   - Search engine (indexing speed, latency)
3. Click component for detailed metrics
4. Investigate red/yellow indicators

**Q: How do I run a backup manually?**
A:
1. Go to Admin → Maintenance → Backups
2. Click "Backup Now"
3. Confirm backup (takes 2-3 minutes)
4. Backup stored in S3 with timestamp
5. Previous backups listed with restore option
6. Automatic daily backups also run at 2 AM UTC

**Q: How do I restore from a backup?**
A:
1. Go to Admin → Maintenance → Backups
2. Find desired backup in list
3. Click "Restore"
4. Confirm restoration (caution: current data will be overwritten)
5. System initiates restore process
6. ~15-30 minutes for completion
7. Application briefly unavailable during restore
8. Audit log records restoration

**Q: How do I manage database indexes?**
A:
1. Go to Admin → Database → Indexes
2. View existing indexes and statistics
3. Check index usage (scans, tuples)
4. Identify unused indexes: `idx_scan = 0`
5. Click to drop unused indexes
6. Monitor query performance after dropping
7. Create new indexes if queries slow down

### Security & Compliance

**Q: How do I run a security audit?**
A:
1. Go to Admin → Security → Audit Report
2. Choose audit type (full, quick, focused on area)
3. Click "Run Audit"
4. System checks:
   - User permissions and access levels
   - SSL/TLS certificate validity
   - WAF rules and configurations
   - Password policies enforcement
   - MFA adoption rate
5. View results with recommendations
6. Export audit report (PDF)

**Q: How do I verify compliance?**
A:
1. Go to Admin → Compliance → Compliance Dashboard
2. View compliance status by framework:
   - FAR 52.209-2 (gov procurement rules)
   - NIST 800-53 (cybersecurity)
   - PCI DSS (payment card data)
3. Click framework for details
4. View control status (compliant/non-compliant/not applicable)
5. View evidence and documentation
6. Generate compliance report

**Q: How do I respond to a security incident?**
A:
1. Go to Admin → Security → Incident Management
2. Click "Report Incident"
3. Fill out incident details:
   - What happened
   - When it was discovered
   - Systems affected
   - Potential impact
4. Incident assigned severity (P0-P3)
5. Auto-escalates based on severity
6. Track remediation steps
7. Close incident when resolved
8. Post-incident review captured

---

## Knowledge Base

### System Architecture

**Q: What is the system architecture?**
A: The SSS Platform uses:
- **Frontend:** React + TypeScript + Tailwind CSS (browser-based)
- **Backend:** Node.js + Express.js (REST + GraphQL APIs)
- **Database:** PostgreSQL (relational data)
- **Cache:** Redis (sessions, hot data)
- **Search:** Elasticsearch (full-text search)
- **Infrastructure:** AWS (ECS Fargate, RDS, ElastiCache, S3, ALB)
- **Deployment:** GitHub Actions CI/CD → ECS auto-deployment
- **Monitoring:** CloudWatch + X-Ray (observability)

**Q: What are the main API endpoints?**
A:
- `POST /api/cases` - Create new case
- `GET /api/cases/{id}` - Get case details
- `PATCH /api/cases/{id}` - Update case
- `GET /api/cases/search` - Search cases
- `POST /api/cases/{id}/decide` - Case approval/denial
- `POST /api/exemptions` - Request exemption
- `GET /api/exemptions/{id}` - Get exemption details
- `POST /api/exemptions/{id}/decide` - Approve/deny exemption
- `GET /api/dashboard` - Get dashboard data
- `POST /api/reports/generate` - Generate custom report

**Q: What is the database schema?**
A: Main tables:
- `users` - System users (citizens, managers, admins)
- `cases` - Case submissions
- `case_documents` - Case attachments
- `case_decisions` - Approval/denial decisions
- `exemptions` - Exemption requests
- `audit_logs` - Complete audit trail
- `notifications` - Email/SMS queue
- `reports` - Scheduled reports

### Performance & Optimization

**Q: What is the expected response time?**
A:
- API endpoints: <500ms p95
- Dashboard load: <2 seconds
- Search queries: <1 second
- Case submission: <5 seconds
- Report generation: <30 seconds (large reports)

**Q: How is search optimized?**
A:
- Elasticsearch indexes all cases
- Partial word matching enabled
- Results ranked by relevance
- Pagination with 25 results per page
- Faceted search available (filter by status, date)

**Q: How is caching implemented?**
A:
- Session data cached in Redis (24-hour TTL)
- Case details cached (1-hour TTL)
- Search results cached (5-minute TTL)
- ML model predictions cached (24-hour TTL)
- Cache invalidated on writes

**Q: What is the ML model accuracy?**
A:
- Overall accuracy: 92%
- Precision: 90% (correctly identifies eligible)
- Recall: 93% (finds all potentially eligible)
- F1 score: 0.91
- Model retrains monthly with new data

---

## Glossary

**ABAC** - Attribute-Based Access Control (permission system based on user attributes)
**ACME** - Challenge protocol for SSL certificate validation
**ALB** - Application Load Balancer (AWS service)
**API** - Application Programming Interface
**CSRF** - Cross-Site Request Forgery (security vulnerability)
**Dashboard** - Real-time analytics view
**DNS** - Domain Name System
**ECS** - Elastic Container Service (AWS service)
**ElastiCache** - Managed Redis/Memcached (AWS service)
**Elasticsearch** - Search and analytics engine
**FAR 52.209-2** - Federal Acquisition Regulation for government compliance
**GraphQL** - API query language
**HTTPS** - Secure HTTP
**JWT** - JSON Web Token (authentication token)
**NIST 800-53** - Cybersecurity standards
**OPA** - Open Policy Agent (policy engine)
**PCI DSS** - Payment Card Industry Data Security Standard
**RDS** - Relational Database Service (AWS service)
**Rego** - Open Policy Agent policy language
**REST** - Representational State Transfer (API architecture)
**RLS** - Row-Level Security (database feature)
**RPO** - Recovery Point Objective (how much data loss is acceptable)
**RTO** - Recovery Time Objective (time to restore service)
**S3** - Simple Storage Service (AWS service)
**SLA** - Service Level Agreement
**SNS** - Simple Notification Service (AWS service)
**SQL Injection** - Security vulnerability
**SQS** - Simple Queue Service (AWS service)
**SSL/TLS** - Secure Sockets Layer / Transport Layer Security
**TOTP** - Time-Based One-Time Password (authenticator app)
**WAF** - Web Application Firewall (AWS service)
**XSS** - Cross-Site Scripting (security vulnerability)
**X-Ray** - AWS distributed tracing service

---

**Status:** ✅ COMPLETE
