Here are the specific sections of your Functional Requirements Specification that need to be updated for the "panel-side" version. This integrates the 5-role architecture, the Regional Web Portal for uploads, and the Citizen crowdsourcing/heatmap features, while fully retaining the Explainable AI (XAI) components the panel expects to see.

You can copy and paste these directly over their respective sections in your document.

---

**Module 1: Authentication and Access Control** **c. Role-Based Access Control (RBAC)** i. System shall support five (5) distinct user roles: (Keycloak Realm Roles)

* **Regional Encoder:** Can create, edit, and upload incident records via the Regional Web Portal; resolve duplicates; access offline mode  
* **National Validator:** Can review and approve incident records; flag inconsistencies; no creation rights  
* **National Analyst:** Read-only access to aggregated data, statistical trends, and reports; cannot modify records  
* **System Administrator:** Full system access including user management, security monitoring, audit log review, and XAI threat analysis  
* **Citizen:** Can submit preliminary crowdsourced fire reports and securely view anonymized public heatmaps. ii. Access permissions enforced through Keycloak Identity Provider (Python Keycloak \+ FastAPI Dependencies) iii. Least privilege principle applied \- users can only access functions required for their role (React Guard Components) iv. Role assignment and modification restricted to System Administrators (Keycloak Admin Console)

**Module 2: Offline-First Incident Management** **a. Incident Data Entry** i. **Regional Encoder** can create new fire incident reports via the **Regional Web Portal** with the following fields: (React Hook Form \+ Zod)

* Incident ID (auto-generated, immutable) (UUID (v4))  
* Date and time of incident (timestamp)  
* Location (address, municipality, province)  
* Incident type (structure fire, vehicular fire, grass fire, others)  
* Incident narrative (free-text description)  
* Casualties (injuries, fatalities)  
* Property damage estimate  
* Responders deployed  
* Fire suppression status (ongoing, contained, extinguished)

**d. Incident Status Tracking** iii. **Regional Encoder** can view the history of status changes for each incident (React Timeline Component)

**Module 3: Conflict Detection and Manual Verification** **b. Manual Verification Workflow** iii. National Validator actions: (FastAPI RPC-style Endpoints)

* Confirm as Duplicate: Merge records, retain only one in the database, log merge action  
* Confirm as Unique: Clear "Flagged" status, approve for storage  
* Request Revision: Return to **Regional Encoder** with specific instructions iv. **Regional Encoder** shall be notified of verification decision via in-app notification (Server-Sent Events (SSE)) v. **Regional Encoder** can view comparison details and provide clarification if requested

**c. Revision and Resubmission** i. If the incident is returned for revision: (sqlalchemy-continuum)

* **Regional Encoder** receives notification with reason for return  
* Encoder can edit incident details and resubmit  
* System logs revision history (original version preserved)

**Module 5: Analytics and Reporting**

*(Note: Add this entirely new subsection below 5.c to cover the Citizen requirements)*

**d. Public Citizen Dashboard and Crowdsourcing**

i. The system shall expose a secure, public-facing portal tailored for the **Citizen** role.

ii. Citizens shall have read-only access to view an anonymized Geographic heatmap of incident frequency to promote public awareness (React Leaflet \+ Leaflet.heat).

iii. Citizens can submit crowdsourced digital fire reports and media attachments, which are automatically routed to the "Pending" queue for the National Validator's review.

iv. Citizen access shall strictly enforce the Data Privacy Act (RA 10173\) by entirely decoupling Personally Identifiable Information (PII) from the public heatmap payload.

**Module 10: Compliance and Data Privacy** **c. Records of Processing Activities (RoPA)** i. System shall maintain RoPA documenting:

* Categories of data subjects (**Regional Encoders**, Validators, Analysts, Administrators, **Citizens**)  
* Categories of personal data (names, user IDs, email addresses, login timestamps)  
* Purposes of processing (incident reporting, access control, audit logging)  
* Data retention periods (active records: indefinite; audit logs: 7 years)  
* Security measures (encryption, access control, audit logging)

**Module 12: User Management and Administration** **a. User Onboarding** iii. Required user information:

* Full name  
* Email address (serves as username)  
* Role assignment (**Regional Encoder**, Validator, Analyst, Administrator, **Citizen**)  
* Contact number (optional) 

Add Heatmap