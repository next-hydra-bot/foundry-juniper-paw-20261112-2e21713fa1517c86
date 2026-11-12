# B2C Purchasing

## Language

**Customer Registration**: An authenticated shopper creates or links their Customer and completes their profile without requesting company membership or approval. _Avoid_: Personal Registration, Company Registration, company provisioning

**Customer Account**: A Customer's profile and Customer-owned saved addresses, independent of their company memberships. _Avoid_: Personal Account, Business Unit, company account

**B2C Purchasing**: Consumer purchasing on the shopper's own behalf, independently of any company Buying Context. _Avoid_: Personal Purchasing, Company Purchasing, company role

**B2C Purchasing Context**: The Store and verified shopper authority under which B2C purchasing occurs. _Avoid_: Personal Context, company Buying Context

## Relationships

- Customer Shopping Lists belong to the verified Customer and an explicit Store, independently of company lists. Customer ownership authorizes access without company Permission Grants.

- Customer Registration belongs to the authenticated shopper; email matching alone does not establish ownership.
- Customer Registration creates no company membership and requires no company approval.
- The same Customer may use B2C purchasing and also belong to one or more companies.
- Removing company membership does not retire a Customer enrolled for B2C purchasing.

- Customer order history reads only personal purchases, excluding the same Customer’s company purchases. Store filtering is explicit and independent of presentation locale; recorded currencies remain unchanged. B2C owns these programs and account routes and uses Core’s `OrderQueries` capability.
