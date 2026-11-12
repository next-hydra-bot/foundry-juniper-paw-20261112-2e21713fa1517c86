# Application Authorization

## Language

**Impersonation**: A native identity-provider session in which a staff member acts as a customer while their identities remain distinct. Preparing a dashboard handoff does not establish a session.

**Session Actor**: Provider-verified facts identifying the impersonator, separate from the customer subject and that customer's permissions. WorkOS's staff email does not establish an immutable staff ID.

**Impersonation Audit Source**: The selected source for reading impersonation-session facts. Coverage distinguishes historical records from active sessions; native dashboard records and independent archives can have different retention.

**Impersonation Observation**: A verified customer-session and actor pair delivered to a selected archive recorder. Observation time is independent of native session creation time; repeated observations must not create duplicate sessions.

**Auth User**: An identity managed by the selected authentication provider. Its identity is separate from a commerce Customer and from memberships or Permission Grants. _Avoid_: Customer, Company Member

**Auth User Key**: A stable owner-assigned reference to an Auth User, independent of the provider-issued Auth User ID and mutable email. _Avoid_: Login email, provider user ID

**Permission**: A named application action that a user may perform within a Scope. Each feature defines the actions it supports. _Avoid_: Role name, OAuth scope

**Permission Definition**: A feature-owned literal action name, independent of provider encoding and user grants. _Avoid_: Role assignment, granted scope

**Permission Manifest**: The permission definitions from features installed by a Composition Recipe, composed as TypeScript values with an inferred union. Admin and storefront have separate manifests. A manifest declares the vocabulary, not anyone's authority. _Avoid_: User grant document, global role map

**Scope**: The resource within which a Permission applies, identified by its resource type and identity. A Business Unit or an auth Organization can be a Scope. Access to one Scope does not imply access to another. _Avoid_: Implicit global user permission

**Permission Context**: The verified user and Scope for which an application evaluates authority. _Avoid_: Selected company alone, client-provided authority

**Permission Grant**: An explicit assignment of Permissions to one user in one Scope. A Role can group Permissions into a preset without restricting the application's Permission vocabulary. _Avoid_: Native commerce role, global company role table

**Scoped Role Assignment**: A set of role keys assigned to an Auth User within one Scope. Verified session claims may carry these assignments; feature-owned policies derive Permissions from them. Assignments in one Scope grant nothing in another. _Avoid_: Active company, global user role

**Session Claim Definition**: A recipe-selected mapping from server-managed user metadata into a named session claim. Auth Contract owns the generic scoped-role document's definition; domain recipes select it without defining provider template syntax. Provisioning configures the mapping. _Avoid_: User grant, role policy

**Permission Check**: Evaluation of whether the current Permission Context has a particular Permission. Missing authority denies the action; inability to determine authority is a failed check. _Avoid_: Authentication check, company membership check
