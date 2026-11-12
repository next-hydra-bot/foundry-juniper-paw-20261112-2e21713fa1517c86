# Checkout

The Checkout context describes how a buyer completes the information and choices required to turn a cart into an order-ready purchase.

## Package ownership

Commerce Core owns schemas, capability definitions and domain-coupled storefront behavior. Framework-independent domain entry points share a package with explicit Next.js and UI entry points. Provider adapters consume domain entry points; provider-owned checkout UI and Actions can also consume Core framework binding contracts. Applications compose the concrete Layers. Commercetools Complete Checkout lives in its provider package and replaces the default application-managed checkout assembly through a recipe. Its provider shipping mode stays outside Cart Snapshot. The design system owns presentation props, callbacks and slots and does not import commerce schemas, action protocols or contextual hooks. Core supplies those props and slots from connected views.

Core also owns the provider-neutral JSON Product Model, catalog input schema and bundled B2B/B2C JSON sources. The Product Model declares flexible typed attributes and selection dimensions and generates Core application schemas; providers derive native definitions, writes and reads from that same model. Agents can supply custom models and catalog JSON, validate before provisioning, and import model prerequisites plus data through the selected provider. Core also owns provider-facing market selling and company pricing assignment schemas; Commerce B2B owns the example Business Unit assignments and purchasing workflows. Catalog input includes a default locale, product/category content translations, category-key references and ordered variant image galleries. Provider import tools validate that input and map it into native resources; Migrate SDK orchestration and provisioning remain provider-owned. Product Type selection dimensions are shared domain rules so both adapters reconstruct the same Product Options from typed attributes.

Core's `CustomerProfiles` capability saves a Customer profile for a server-authenticated identity without provisioning a Business Unit. Authentication owns the identity and email; the account form owns editable names. B2C supplies Customer Registration and account programs and UI, while the application composes its authentication and commerce provider Layers.

The customer account overview uses the verified site identity. Commerce Core installs the shared account layout, overview and overview loader. The layout resolves installed destinations through an application-owned navigation binding and keeps its header and sidebar mounted while child routes load. A small client leaf selects the active section with Next.js's selected layout segment. Feature packages supply content-only pages and loaders; each page and action retains its own authorization. Profile/address editing and company member management have distinct child routes. Provider-native authentication uses a document handoff only when a customer connection is required; connected account links use the App Router without prefetching.

Shopping Store and currency derive from the configured locale mapping at storefront HTTP boundaries. API clients supply locale and an explicit Business Unit for company purchasing. An explicitly requested unavailable Business Unit is rejected; only an omitted web selection may use the first eligible membership.

Historical Order HTTP requests explicitly select one Store or all Stores independently of presentation locale. Core owns the common Order transport schema and error mapping; buying recipes supply the existing B2C/B2B read programs and provider API add-ons optionally mount them. Company history checks the selected Business Unit permission against verified bearer metadata, separate from Admin authorization. See [HTTP contracts](http/README.md).

Core owns transport-neutral Cart and Product Discovery HTTP contracts and programs. A provider recipe can apply its own authentication and request middleware to those groups. Shopify's optional HTTP assembly requires verified site and native customer credentials, resolves authorized company locations, keeps native cart credentials private and returns a fresh hosted Checkout Destination. Its native-client transport is separate from Next.js cookie persistence; it does not install custom CheckoutSession payment or Order placement commands.

Application-owned Order Lifecycle processing is installed only through the optional `commerce-order-workflow` add-on. Shopify uses its native order handling by default; a custom workflow is an explicit choice for additional application logic. Order listing and detail do not depend on that choice. Selecting the add-on installs its workflow runtime, event receiver, native Order checkpoints and application emails together, with provider-specific setup to coordinate native notifications.

## Language

**Shopping List**: A saved collection of requested Product Variants and quantities in a Store. A Customer list belongs to the verified site user. A Business Unit list retains its Business Unit and may also identify its associated site user; permissions distinguish the buyer's own lists from colleagues' lists. A saved list does not establish current price or purchasability.

**Shopping List Line Item**: A saved entry with its own identity, requested quantity and time of addition. Its identity is separate from the Product Variant reference. Adding the same Variant increases the saved quantity; changing a line's quantity replaces it.

**Shopping List Revision**: An opaque observation of a saved list used to reject changes based on stale content.

**Order Lifecycle**: Background processing that acknowledges an Order, observes fulfillment and payment, and completes the Order when no fulfillment or payment work remains.

**Order Notification**: A message to the Order's recorded recipient based on recorded purchase data and a proven lifecycle transition.

**Order Completion**: The end of fulfillment and payment work for an Order. Shipping alone does not complete an Order on payment terms.

**Checkout**: The buyer-facing process for completing the information and choices required before placing an order. _Avoid_: Checkout page, checkout wizard

**Cart**: The current collection of products and cart-owned checkout details being prepared for purchase in a Store and, for B2B Checkout, a Business Unit. _Avoid_: Checkout state

**Cart Line Item**: One Product Variant and its requested quantity in a Cart. Its identity lets checkout choices refer to that exact Cart entry rather than to the Product in general. _Avoid_: Product, Provider Line Item

**Cart Line Item Summary Attribute**: One presentation-ready Product Attribute selected by a commerce provider to identify a Product Variant in compact Cart presentations. Its label and value are already localized and formatted. _Avoid_: Raw Product Attribute, Product Attribute bag

**Cart Snapshot**: An observation of a Cart's current semantic state, independent of provider resource revisions and storage representation. _Avoid_: Provider Cart, Cart version

**Current Cart**: The Cart resolved for the buyer's current Store and, for B2B activity, Business Unit Buying Context. The selected provider resolves the Current Cart using its cart persistence capability. The account-backed implementation uses the `cart` cookie for anonymous purchasing; other providers retain private credentials behind `CurrentCartStorage`. _Avoid_: Cart Session, arbitrary Cart

**Carts**: The existing provider-neutral account-backed Cart operations, used by account Cart selection and application-managed Checkout. Providers serving other cart persistence models do not need to implement this complete interface. _Avoid_: Cart repository, global Cart service

**Current Cart Storage**: The request-scoped capability that resolves and creates the selected Cart and persists shopping mutations while keeping provider credentials private. _Avoid_: Customer cart list, checkout persistence

**Commerce Cart Layer**: The Effect Layer that provides Current Cart Storage for one commerce provider while keeping provider revisions, payloads, and retry mechanics private. _Avoid_: Adapter, repository implementation

**Cart Identity**: The stable identity of a Cart, observable by callers for correlation and stale-form detection but never sufficient to select or authorize the Current Cart. _Avoid_: Cart authority, Cart version

**Product Attribute**: A typed characteristic of a purchasable Product Variant. A provider may source it from Product- or Variant-level storage, but the domain value does not retain that origin. _Avoid_: Provider attribute payload, raw attribute, attribute origin

**Product**: A catalog item that groups shared merchandising information with one or more purchasable Product Variants. A Product is discovered and presented but is not itself purchased. _Avoid_: Provider Product Projection, purchasable Product

**Product Card**: The compact Product projection used in catalog collections and discovery. _Avoid_: Product Summary, Product Card DTO, Product Card component props

**Product Detail**: The complete Product projection used to present and select a purchasable Product Variant. _Avoid_: Product Details DTO, Product page, Provider Product Projection

**Product Variant**: The purchasable Product projection represented by a Cart Line Item, including its effective Product Attributes. _Avoid_: Provider Product and Variant hierarchy

**Variant ID**: An opaque purchasable reference produced and resolved by the selected commerce provider. It identifies merchandise across Products within that provider and is passed unchanged from Product Detail to Cart commands. Shared code must not parse it, construct it from a Product ID, or substitute a SKU. Product and Cart projections use the same reference. _Avoid_: Product-local variant number, SKU, caller-supplied Product/Variant pair

**Default Product Variant**: The Product Variant initially selected when Product Detail is presented. It must be one of the Product Detail's purchasable Product Variants. _Avoid_: Master Variant, first array element

**Product Price**: The price selected for a Product Variant in the current Commerce Context, including an optional discount applied to that selected price. _Avoid_: Price candidates, Customer Group price list, provider price payload

**Product Availability**: Whether a Product Variant can currently be purchased in the Commerce Context, together with an available quantity when the provider can report one. _Avoid_: Supply Channel inventory, stock-record payload, quantity-derived saleability

**Product Option**: A named selection dimension whose values distinguish purchasable Product Variants, such as Model or Color. _Avoid_: Descriptive Product Attribute, provider option type

**Product Category**: A catalog classification used to discover or contextualize Products. A browsable Product Category has an opaque provider ID, a stable Category Key, a localized name and URL slug, and an optional description. Shopify Collections and commercetools Categories supply this read model; the installed Search provider supplies the category-filtered listing. The Category Key remains unchanged when the URL is translated. _Avoid_: Provider Category payload, CMS Category field

**Product Catalog**: The Products and Product Variants eligible for discovery and purchase in a Store. _Avoid_: Product Selection, sales channel, provider catalog payload

**Assortment**: A named set of Products made eligible for purchase in a selling context. _Avoid_: Product dataset, provider publication

**Catalog Price List**: A named set of fixed SKU prices in one declared currency, applied independently of the market Assortment. _Avoid_: Contract, default locale currency

**Company Pricing Group**: A named grouping of Business Units that share applicable Catalog Price Lists. Membership belongs to the company Buying Context and applies to an individual only while purchasing for that Business Unit. Product Assortment and Store selection remain separate. _Avoid_: Authentication role, employee tag, Store, geographic region

**Company Profile**: The editable name, contact phone and default billing and shipping addresses for the selected Business Unit. A parent company's identity remains distinct from a location's editable details. _Avoid_: Authentication profile, arbitrary address collection

**Company Purchasing Policy**: An explicitly configured Company Pricing Group in a declared Store, locale and currency. Product availability belongs to the Store/market and is shared by its buyers. An approval selects and preserves those buying terms; company membership alone does not select them. _Avoid_: Default pricing, address-derived Market, employee role

**Product Type**: A catalog schema that identifies which typed Product Attributes are available for a Product's Variants. _Avoid_: Untyped attribute bag, provider Product Type payload

**Cart Policy**: A rule based only on Cart data that determines whether the Cart is purchasable as currently composed. _Avoid_: Checkout policy

**Cart Policy Violation**: A reason the Cart is not purchasable as currently composed. _Avoid_: Checkout policy violation

**Checkout State**: The derived view of Checkout progress and available actions for the current Cart. _Avoid_: Stored checkout, checkout aggregate

**Checkout Read Schema**: The structural shape that can represent ordinary incomplete Checkout. _Avoid_: Completed checkout schema

**Checkout Action Schema**: The stricter structural shape required to perform a Checkout action. _Avoid_: Checkout state schema

**Checkout Detail**: A current detail used to evaluate Checkout, either saved on the Cart or derived for the current Cart. _Avoid_: Option list, choice catalog

**Checkout Mutation**: An action that saves cart-backed checkout details without owning Checkout State. _Avoid_: Checkout state update

**Checkout Mutation Failure**: A typed reason a Checkout Mutation could not save its requested details. _Avoid_: Exception, generic error

**Checkout Mutation Outcome Unknown**: A Checkout Mutation Failure emitted when the Cart provider may have accepted the write but its result could not be confirmed. Callers refresh Checkout before deciding whether another write is needed; Delivery Details retains any Address Book Reference saved before the ambiguous Cart write. _Avoid_: Provider failure, version conflict

**Commerce Principal**: The verified commerce identity resolved for a request: anonymous Cart possession, an authenticated Customer using B2C Purchasing, or an authenticated Customer acting in a verified Business Unit. _Avoid_: HTTP headers, Checkout Scope, Registration Actor

**Commerce Context Request**: The trusted Store and buyer selectors decoded at a request boundary before provider-backed commerce identity is resolved. An authenticated request carries a verified Auth User ID and may carry a requested Business Unit ID; it never accepts a Customer ID as authority. _Avoid_: Resolved principal, raw headers, auth session

**Commerce Context**: The current Store and verified Commerce Principal under which commerce activity occurs. _Avoid_: Commerce Request Context, auth session, raw request, Checkout Scope

**Checkout Scope**: The value object that identifies which storefront Checkout context is being evaluated, such as anonymous checkout for a locale/cart or customer checkout for a locale/customer. _Avoid_: HTTP headers, cookie bag, auth session

**Current Checkout Scope**: A request-scoped Effect context value supplied by an adapter or middleware when transport context has already been resolved. _Avoid_: Checkout capability, persistent session

**CheckoutSession**: The public Effect Service for application-managed Checkout use-case programs, owned by `@repo/commerce-checkout`. _Avoid_: HTTP handler, stored session data

**Checkout Destination**: An application-relative location or trusted provider URL at which Checkout is presented. A local location may mount provider-managed UI. _Avoid_: Execution owner, always external redirect

**Checkout Receipt**: An authorized observation that an Order exists, with its separately reported payment status. It does not require an application-owned Payment Reference. _Avoid_: Paid receipt, browser success callback

**Order**: A recorded purchase with its own identity, recorded amounts and purchased item descriptions. A draft awaiting acceptance is not yet an Order. _Avoid_: Cart, Payment, checkout callback

**Order History**: The Orders visible to a Customer buying on their own behalf or acting in a selected Business Unit, for an explicitly selected Store or across all Stores. Ownership and permission always constrain visibility; presentation locale does not select the Store, and amounts retain their recorded currencies. A provider with a rolling historical access window reports its day limit with the listing so storefront and HTTP clients can distinguish available history from unrestricted history. _Avoid_: Current Cart history, locale-derived history

**Order Summary**: A compact observation of an Order's identity, creation date, purchasing context, current recorded total and independent status observations. _Avoid_: Cart projection, payment receipt

**Order Filters**: Exact Order and purchase-order numbers, an inclusive-start/exclusive-end creation range in UTC, and independent payment, fulfillment and cancellation selections. All supplied filters must match within the already-authorized Customer or Business Unit and explicit Store selection. A continuation can represent unfinished backend scanning; an empty page alone does not prove the search is exhausted.

**Order Detail**: An observation of an Order's purchased items, recorded addresses, financial amounts and fulfillment records. Catalog changes do not rewrite purchased descriptions. _Avoid_: Current Product Detail, Checkout State

**Email Order Access**: Permission to read one personal Order through a link delivered to its recorded recipient. It does not establish a Customer sign-in, allow listing other Orders, or grant company permissions. The current recipient and original Store must still match when the Order is read.

**Order Access Link**: A bearer link conveying Email Order Access. It has no time expiry; changing the recorded recipient or revoking the issuer's credentials ends its authority. Forwarding the link also forwards access to that Order.

**Order Line Item**: A purchased item description and quantity recorded on an Order. It remains valid when its Product or Variant is custom, deleted or otherwise unavailable in the current catalog. _Avoid_: Current Product Variant, Cart Line Item

**Order Amount**: An exact monetary observation in its recorded currency, with explicit tax treatment when applicable. Original total, current total, collected funds, refunds and outstanding balance have different meanings. _Avoid_: Current catalog price, converted Store amount

**Order Payment Status**: The observed financial state of an Order, independently of cancellation, fulfillment and delivery. An accepted Order can still have an outstanding balance. _Avoid_: Order status, shipment status

**Order Fulfillment Status**: The observed progress of preparing and fulfilling an Order's items. Fulfillment alone does not establish physical delivery. _Avoid_: Delivery status, payment status

**Order Delivery Status**: The observed physical shipping and delivery progress of an Order or fulfillment. _Avoid_: Checkout Shipping Option, fulfillment status

**Order Workflow State**: A merchant's labeled business state for an Order. Its meaning is independent of payment, fulfillment and delivery observations. _Avoid_: Universal order status, payment status

**Checkout Use-Case Program**: An externally meaningful Checkout operation exposed by `CheckoutSession`, such as getting current Checkout State or saving Contact. _Avoid_: Mapper, decoder, implementation helper

**Checkout State Builder**: The internal function that builds `CheckoutState` from already-resolved Checkout inputs. _Avoid_: Fetcher, Service, use-case program

**Cart Write Conflict**: A Cart persistence failure emitted when conflict recovery is exhausted without exposing a provider revision. _Avoid_: Checkout version conflict, provider version

**Checkout Cart Mismatch**: A Checkout Mutation Failure caused when the submitted Cart ID differs from the authoritative Cart resolved for the current Checkout context. _Avoid_: Version conflict, authorization check

**Checkout Policy**: A rule that can block Checkout progress based on the Cart, buyer context, and checkout details. _Avoid_: Cart policy

**Checkout Policy Violation**: A reason Checkout progress is blocked by a Checkout Policy. _Avoid_: Cart issue, policy error

**Violation Target**: The part of Checkout or Cart that a policy violation explains. _Avoid_: Affected UI element

**Checkout Violation**: A normalized violation included in Checkout State, preserving whether it came from Cart Policy or Checkout Policy. _Avoid_: Step error

**Checkout Step**: A section of Checkout with a completion condition derived from current checkout details. _Avoid_: Saved step, persisted step

**Contact**: The Checkout Step that establishes how the buyer is known for Checkout. _Avoid_: Buyer identification, login step, account step

**Contact Input**: A detail or choice submitted to resolve Contact for the current Checkout. _Avoid_: Provider payload, form field

**Delivery Details Input**: The buyer-submitted choice used to establish the Shipping Address: a manually entered address with optional Address Book save preferences, or an existing Address Book Entry. _Avoid_: Resolved Delivery Details, provider address payload

**Contact Source Policy**: A rule that determines whether a Contact Source is allowed for the current Checkout. _Avoid_: UI-only rule

**Contact Source**: The selected strategy for resolving Buyer Contact, such as manual entry or customer profile. _Avoid_: Guest, provider field name, field-level provenance

**Store**: A named commerce selling context in which a buyer browses, owns a Current Cart, and begins a purchase. Its identity is separate from its eligible locales, currencies, destination countries and Company Pricing Groups. _Avoid_: Locale, sales channel, Company Pricing Group, merchant tenant

**Store Attribution**: The recorded Store in which a Cart originated and to which its Order remains attributed. Changing a delivery address or applicable pricing does not reassign that origin. An Order created without a recorded Store has unknown attribution. _Avoid_: Final checkout region, currency-derived Store, Company Pricing Group

**Store Key**: The stable domain identifier used to select a Store across request and commerce-provider boundaries. _Avoid_: Locale, provider Store payload

**Business Unit**: A company or company division in which an authenticated Customer may act, directly or through an inherited company hierarchy. _Avoid_: Account, provider Business Unit payload

**Business Unit ID**: The stable domain identifier used to select a Business Unit. A submitted Business Unit ID is a selector that must be verified against the authenticated Customer's memberships in the current Store. _Avoid_: Business Unit authority, Business Unit key

**Business Unit Key**: A stable owner-assigned reference to a Business Unit, independent of its provider-issued identity and display label. _Avoid_: Native resource ID, Business Unit Label

**Business Unit Label**: The human-readable name used to present a Business Unit to a buyer. It is display text, not Business Unit identity or authority. _Avoid_: Business Unit key, provider name field

**Business Unit Membership**: A provider-reported relationship showing that a Customer may act in a Business Unit within a Store, directly or through an inherited hierarchy. _Avoid_: Current Buying Context, selected Business Unit

**Customer**: A commerce identity and profile that can be linked to an authenticated person. The same Customer may purchase through B2C and act within verified Business Units through B2B. _Avoid_: B2C Customer, authentication user, Business Unit

**Customer Key**: A stable owner-assigned reference to a Customer, independent of the Customer's provider-issued identity and mutable email. _Avoid_: Login email, Auth User ID, native Customer ID

**Customer Identity Link**: The immutable Auth User ID stored on a Commerce Customer and used to resolve that Customer after authentication. Email is mutable profile data and is not this link. _Avoid_: Customer email identity, Login email key

**Orphan Customer**: A Commerce Customer with no direct or inherited Business Unit Membership anywhere in the commerce project. Removing the final membership retires a company-only Customer while retaining a Customer enrolled for B2C Purchasing; its authentication identity remains intact. _Avoid_: Deleted user, Disabled identity

**Company Role**: A business authorization assigned to a Customer within a Business Unit: Admin, Buyer, or Approver. A Customer can hold a non-empty set of Company Roles whose permissions combine. _Avoid_: Owner, Associate, Identity provider role

**B2C Purchasing**: Consumer purchasing on the shopper's own behalf, without acting in a company Buying Context. An authenticated Customer uses a Customer-owned Cart in the selected Store, independently of any company Cart or anonymous Cart. _Avoid_: Personal Purchasing, Company Purchasing

**Buying Context**: The verified Business Unit in which an authenticated Customer is currently acting for commerce operations in a Store. _Avoid_: Account, unverified company selection

**Buyer Contact**: The contact details used for communicating with the buyer during Checkout, whether entered by the buyer or derived from a known buyer. _Avoid_: Contact information

**Shipping Address**: The delivery destination selected or entered during Checkout. Uses **Address Line 1** for the primary address text and optional **Address Line 2** for secondary address text. _Avoid_: Shipping information

**Billing Address**: The address selected for billing during Payment Options. _Avoid_: Shipping Address, payment method

**Address Line 1**: The primary postal address line used by Checkout. _Avoid_: Street Name, Street Number

**Address Line 2**: Optional secondary postal address text used by Checkout. _Avoid_: Additional Street Info

**Street Address Line**: The complete first street-address line as supplied, including any building number and street name in one value. Numbers are not split into a separate field. _Avoid_: Separate street number, parsed house number

**Country Code**: An ISO 3166-1 alpha-2 code identifying the Shipping Address country. Store or Checkout availability is evaluated separately from structural country-code validity. _Avoid_: Country name, arbitrary region string

**Delivery Details Source**: The selected strategy for resolving Shipping Address, such as manual entry or address book. _Avoid_: Provider address object

**Address Book**: The collection of saved company addresses owned by a Business Unit and available to authenticated buyers acting in that Buying Context. _Avoid_: Customer address book, Checkout address list

**Current Address Book**: The request-scoped Address Book selected from the verified customer and Business Unit Buying Context. Its operations do not accept caller-supplied Customer or Business Unit identity. _Avoid_: Checkout address list, submitted address owner

**Address Book Entry**: A saved company address together with its Address Types and Default Address Flags. _Avoid_: Customer address, Checkout Shipping Address

**Address Book Reference**: A reference to the saved Address Book Entry associated with current Delivery Details. The Cart still owns a complete Shipping Address snapshot; the reference preserves saved-address identity rather than replacing that value. _Avoid_: Copied address book record

**Address Type**: The supported use of an Address Book Entry: Shipping, Billing, or both. _Avoid_: Address source, provider address list

**Default Address Flag**: A marker that identifies an Address Book Entry as the Business Unit default for Shipping or Billing. _Avoid_: Address Type

**Next Checkout Step**: The first incomplete Checkout Step derived from current Checkout Step Completion. It is the next progression target, independent of which step a user interface currently presents. _Avoid_: Active Checkout Step, open step, selected step

**Checkout Step Completion**: The derived state that a Checkout Step's completion condition is currently satisfied. _Avoid_: Completion flag, saved completion

**Delivery Details**: The Checkout Step that establishes the Shipping Address. _Avoid_: Contact information, shipping information

**Shipping Options**: The Checkout Step where the buyer chooses how the order should be delivered. _Avoid_: Delivery options

**Shipping Zone**. A named group of destination countries eligible for the same shipping rates.

**Shipping Service**. A configured way to deliver an order, such as standard delivery, with an offered rate for each served Shipping Zone.

**Flat Shipping Rate**. A fixed amount in one currency for a Shipping Service to a Shipping Zone.

**Delivery Plan**: A checkout-time proposal that allocates a Current Cart into one or more Delivery Groups using explicit Delivery Targets. It does not itself select Shipping Options or describe how an Order is physically fulfilled. _Avoid_: Shipment Plan, Order Deliveries

**Delivery Plan Reference**: The opaque identity of one Delivery Plan calculated for the Current Cart. It lets Checkout select and revalidate a complete proposal without accepting caller-supplied routing or promises. _Avoid_: Fulfillment Route ID, Shipment Plan ID

**Delivery Plan Quote**: The current set of Delivery Plans calculated together for one Current Cart state. Checkout replaces it when Cart contents, delivery destinations, or fulfillment constraints require the plans and their Shipping Options to be recalculated. _Avoid_: Shipping Quote, Rate Quote

**Delivery Plan Quote Reference**: The opaque identity of one Delivery Plan Quote. A buyer returns it with a selection so Checkout can reject choices made against a superseded quote without accepting a browser-supplied price. _Avoid_: Price Token, Browser Price

**Delivery Group**: A non-empty collection of Delivery Targets that share one Shipping Address and require one Shipping Option selection. It is a checkout planning unit, not a physical Shipment or Order Delivery. _Avoid_: Shipment, Package

**Delivery Target**: A positive quantity of one exact Cart Line Item allocated to a Delivery Group. It is always explicit; no wildcard or “all Cart quantities” target exists. _Avoid_: Product Target, Item Selector, All Cart Quantities

**Delivery Promise**: The buyer-facing commitment for when a Delivery Group is expected to arrive or be ready for collection. _Avoid_: Carrier estimate, Fulfillment SLA

**Delivery Routing**: The decision that derives and ranks Delivery Plans from the Current Cart, its delivery destinations, and applicable fulfillment constraints. _Avoid_: Shipping Option selection, Order fulfillment

**Shipping Option**: A currently available way to deliver one Delivery Group, including its buyer-facing description, Delivery-Group-dependent price, and any Delivery Promise that can be made. _Avoid_: Shipping Method, Delivery Option

**Shipping Option Reference**: The opaque identity a buyer submits to select a Shipping Option for one Delivery Group in a Delivery Plan. It identifies a choice without exposing a provider Shipping Method identity as Checkout vocabulary. _Avoid_: Provider Shipping Method ID

**Selected Shipping Option**: The Shipping Option currently saved on the Cart for one Delivery Group, including its applied price and whether it still applies to that group. _Avoid_: Saved Shipping Options Step, Shipping Method payload

**Payment Method**: The way the buyer will pay or settle the order. Card and Net Terms are Payment Methods. _Avoid_: Payment arrangement, Payment Plan

**Payment Method Eligibility**: Whether the current buyer may use a Payment Method based on buyer and account qualifications, independently of how much of the current Cart the method can fund. _Avoid_: Funding sufficiency, saved availability

**Payment Method Funding Capacity**: How much of the current Cart amount an eligible Payment Method can fund: full, partial, or none. _Avoid_: Payment Method Eligibility, authorization, captured amount

**Credit Profile**: The payment terms and available credit associated with a Business Unit's financial account for evaluating Net Terms. _Avoid_: Customer credit, Trade Credit Account, ledger

**Available Credit**: The amount the Business Unit's financial account can currently use toward a purchase before any account-credit authorization or reservation. _Avoid_: Credit limit, reserved credit, ledger balance

**Payment Options**: The Checkout Step where the buyer chooses a Payment Method for the order. _Avoid_: Payment methods step, payment arrangement

**Payment**: The planned and attempted settlement associated with a Cart and its resulting Order. It records the selected Payment Method, planned amount, and financial progress without performing payment processing itself. _Avoid_: Payment Plan, provider Payment Object

**Prepared Payment**: A Payment whose method and current planned amount are saved for Checkout but have not been authorized. _Avoid_: Authorized Payment, Payment Plan

**Payment Authorization**: A financially reliable reservation of funds or account credit that begins only when the buyer places the order. A card authorization can create a visible hold. _Avoid_: Payment save, Payment Method selection

**Payment Capture**: The collection of funds from an authorized card Payment after the Order has been placed. _Avoid_: Payment Authorization, Order placement

**Order Placement Attempt**: One resumable attempt to authorize the selected Payment, place the Order, and then capture funds or commit account-credit exposure. Repeating the same attempt does not create another authorization. _Avoid_: Payment Plan, browser submission

**Review Order**: The Checkout Step where the buyer confirms the order before it is placed. _Avoid_: Review checkout, order summary

**Order Fulfillment**: Preparing and shipping the quantities purchased in an Order. It is independent of the buyer's personal or company buying context. _Avoid_: Checkout, payment collection

**Fulfillment Group**: The purchased quantities that may be prepared and shipped together to one destination. _Avoid_: Shipping Mode, warehouse role

**Delivery**: A recorded allocation of purchased quantities prepared for shipment. _Avoid_: Duplicate preparation progress record

**Parcel**: A shipment of explicit quantities from a Delivery, optionally identified by carrier and tracking number. _Avoid_: Packing draft, shipping label purchase

**Fulfillment Revision**: An opaque revision identifying the Order state against which a fulfillment command was prepared. _Avoid_: Client-generated counter, authorization token

## Relationships

- A **Checkout** has exactly one **Next Checkout Step**.
- A **Checkout** requires an existing non-empty **Cart**.
- A **Product** groups one or more **Product Variants**, and only a Product Variant is purchasable.
- **Product Card** and **Product Detail** are commerce projections of a Product, not provider payloads or presentation component props.
- A **Product Detail** contains at least one purchasable **Product Variant** and identifies exactly one of them as its **Default Product Variant**.
- A **Product Price** is resolved for the current Store and buyer before it enters Product Card or Product Detail; provider channel and customer-group identities are not part of the Product Price.
- **Product Availability** is resolved for the current Store and buyer; available quantity alone does not universally determine whether a Product Variant can be purchased.
- Product discovery occurs in the current **Commerce Context**; callers select Products and Categories without supplying Store, locale, currency, or buyer identity to each operation.
- The **Store** in Commerce Context includes the selected commerce locale and currency used consistently by Product discovery, Cart, and Checkout; it does not contain provider Store mechanics.
- A **Store** explicitly declares its eligible locale and currency combinations; language availability alone does not establish a selling currency or a provider Market.
- A request boundary resolves the **Store** from a configured eligible Store selection or the locale's configured default before constructing **Commerce Context**; a submitted Store Key is a selector, not provider Store data or authority.
- A **Product Option** defines how a buyer distinguishes Product Variants; each Product Variant identifies its value for every Product Option.
- A **Product Attribute** may describe a Variant without participating in Variant selection.
- A **Product Detail** identifies its **Product Type**, and every included Product Variant's Attributes conform to that Product Type's schema.
- Product Card and Product Detail contain only Products and Product Variants in the current Store's **Product Catalog**; Product Card price and availability are derived only from those eligible Variants.
- A **Current Cart** is selected from the buyer's current Store and, for B2B activity, Business Unit Buying Context rather than by treating an arbitrary Cart ID as authority.
- A customer identity authorizes access to profile and associate capabilities; it does not own the **Cart**.
- An anonymous **Cart** belongs to its Store and has no **Buying Context** Business Unit.
- A B2B **Cart** belongs to its Store and **Buying Context** Business Unit, so cart reads and writes should use store-scoped and Business Unit-scoped provider operations rather than customer-owned cart semantics.
- Anonymous and B2B Carts remain separate when the buyer signs in; Checkout does not transfer or merge the anonymous Cart into a Business Unit.
- A **Checkout State** is a lean read model derived from the current **Cart**, buyer context, and **Checkout Details**.
- A request boundary decodes a **Commerce Context Request** from trusted Store resolution, verified authentication, anonymous possession, and an optional Business Unit ID selector.
- An HTTP request proves possession of an anonymous **Current Cart** only with the HttpOnly `cart` cookie; a caller-supplied Cart ID header is neither accepted nor documented.
- `CompanyRegistrationEligibility` determines whether an existing Commerce account blocks a company application. A provider may distinguish an unassigned Customer created during sign-in from an existing company account. This read never links identities or grants company access.
- A provider-native Company Member may not yet have a linked Auth User ID; native membership remains visible without fabricating an application identity. A provider may retain a Customer after their final membership is removed without enrolling them for B2C.
- `CompanyMemberProvisioning` supplies only invitation-time customer/contact and Business Unit membership creation. Company Registration owns invitation policy, identity proof and durable acceptance; providers supply native writes. Providers with full `CommerceAccounts` can adapt that capability without requiring buying-only providers to implement company registration or administration.
- `companyCommerceContextLayer(request)` from `@repo/commerce-b2b` resolves the verified **Commerce Context** once for the request. For authenticated requests it derives Customer ID from Auth User ID, obtains Store-scoped **Business Unit Memberships** through **Commerce Accounts**, and uses the requested verified Business Unit or the first verified membership as the **Buying Context**.
- **Commerce Accounts** reports provider-backed customer mappings, profiles, and Business Unit Memberships; it does not decide which Business Unit is current for a request.
- A **Business Unit Membership** carries every recognized **Company Role** assigned directly or through inheritance; it is not collapsed to one role.
- A Commerce Customer has one **Customer Identity Link**; changing the identity provider email updates profile data without changing that link.
- Removing one **Business Unit Membership** retains the Customer while any direct or inherited membership remains; removing the final membership retires the resulting **Orphan Customer**.
- Retiring an **Orphan Customer** does not delete or disable the linked authentication identity, so later company access can create a fresh Commerce Customer for the same Auth User ID.
- A caller-provided Business Unit ID selects among verified memberships; it does not grant membership. A missing, stale, or invalid selector falls back to the first verified membership, and resolution fails only when the Customer has no eligible membership in the Store. Customer ID is resolved from verified authentication and is never accepted as request authority.
- The provider-selected **Address Book** Layer depends on `CommerceContext`; its `list`, `get`, and `save` methods accept no Customer or Business Unit identity.
- The **Address Book** HTTP API is an authenticated capability boundary with its own contract and errors; it does not expose Checkout endpoints, anonymous Cart inputs, or Checkout errors.
- `CheckoutSession.layer` depends on `CommerceContext` and derives its **Checkout Scope** once for the request.
- `makeCommerceBaseApp` provisions Commerce Context, Current Cart and Product Discovery independently of Checkout execution. The application explicitly adds `makeCheckoutApp` to provision CheckoutSession, Address Book and the custom payment/order workflow.
- `CheckoutSession.getCurrent()` gets current **Checkout State** for that request-bound session; callers do not pass scope or context to session methods.
- A **Checkout State Builder** receives an already-resolved **Checkout Scope**, **Cart Snapshot**, **Checkout Details**, buyer context, **Cart Policy Violations**, and **Checkout Policy Violations**.
- A **Checkout State Builder** validates that Checkout can start, computes binary **Checkout Step** status, computes the **Next Checkout Step**, normalizes violations, and returns **Checkout State**.
- A **Checkout State Builder** does not fetch provider data or resolve request context.
- A **Commerce Context** combines the resolved Store with a verified **Commerce Principal** before Checkout derives **Checkout Scope**.
- An anonymous **Commerce Principal** may exist without a public Cart ID. Current Cart Storage resolves whether a Cart exists using request-bound provider authority. Anonymous Cart access remains possession-based; a public correlation identity alone is not authority.
- HTTP and Next request adapters construct transport-neutral commerce request values from verified authentication, Store selection, Business Unit selection, and, where relevant, anonymous Cart possession. `CommerceApp.layer` composes host-selected stable provider Services. `makeCommerceBaseApp` does not require customer or company Services for a guest-only composition. `CurrentCartStorage` owns provider selection/persistence; `CurrentCart.modify` lets server-side extensions retain authoritative selection and Cart Policy evaluation. Application-managed checkout commands belong to `CheckoutCart` in `commerce-checkout`. The application explicitly supplies the company context resolver through `commerceContextLayer` and separately composes company membership administration Services. `CommerceApp.provide(request)` adds the request-scoped services needed by Cart and Checkout programs, while `CommerceApp.provideAddressBook(request)` adds only `CommerceContext` and `AddressBook` and therefore requires no Cart cookie adapter. The web app owns one module-level `ManagedRuntime`. React Server Component reads execute request-provided programs through `NextCommerce.runPromise`, while Server Action mutations execute shared procedures through `CommerceActions` and `ActionClient`; both resolve the same app-owned runtime and request services. HTTP adapters let their outer Effect HTTP handlers own Layer lifecycles. Callers invoke named Service methods and map typed errors to transport responses; no Contact, Address Book, or Delivery Details operation accepts context or scope.
- A first-slice **Checkout State** reports current **Checkout Details**, binary step status, the **Next Checkout Step**, and **Checkout Violations**.
- A first-slice **Checkout State** does not report structured incompletion reasons.
- Blocking violations in **Checkout State** are global and do not have to belong to a **Checkout Step**.
- A **Checkout State** does not own option lists that have not been saved to the **Cart**.
- A **Checkout State** can return the current saved **Address Book Reference** as Checkout Detail without owning or returning Address Book options.
- A **Checkout Read Schema** can represent ordinary incomplete **Checkout**.
- A **Checkout Action Schema** can require the details needed for a specific action.
- A **Checkout State** includes **Checkout Violations** as one global list.
- A **Checkout Violation** preserves whether it came from a **Cart Policy** or **Checkout Policy**.
- A **Checkout Violation** carries a stable code and schema-backed parameters, not a rendered public message.
- A **Checkout Policy Violation** retains a diagnostic message for logging and observability; normalization into public **Checkout State** deliberately drops it.
- Presentation adapters translate Checkout Violation codes and parameters using the resolved locale.
- The public Checkout HTTP representation adds a localized fallback message to each **Checkout Violation** while retaining its stable code and parameters, so clients may map the code or render the supplied message.
- First-slice **Checkout Violations** are blocking.
- A **Checkout Mutation** can change the **Cart** details from which **Checkout State** is derived.
- A **Checkout Mutation Failure** prevents the requested details from being saved.
- Effect error messages and causes are diagnostic. A client-recoverable Checkout Mutation Failure is projected once into a safe public error that keeps its exact `_tag`, adds a broad `category`, stable `code`, and `recovery`, and exposes only deliberate fields and a localized message. Classified provider or transport outages remain typed failures; invalid provider data, response-schema mismatches, trusted-context decoding failures, and unsupported compositions are defects.
- Checkout Server Actions and Checkout HTTP endpoints use the same public error schemas and projectors for overlapping operations. Clients may branch precisely by `_tag`, handle a broad class by `category`, follow `recovery`, or render the supplied message directly.
- Replacement-style **Checkout Mutations** are idempotent for the same requested details.
- The Commercetools client retries transient HTTP failures, but it does not retry `ConcurrentModification` globally. Each versioned-write boundary chooses how to reconcile its own mutation.
- Shared versioned-write infrastructure decodes the provider's current version and bounds conflict handling to one retry; it does not decide which action is safe to repeat.
- A state-independent replacement-style **Checkout Mutation** resends the same narrow Cart action with the provider's current version after `ConcurrentModification`; it does not reload or compare Cart fields.
- Saving Contact never blindly repeats `setCustomType`. If the Checkout Custom Type was absent, Checkout reloads the authoritative Cart, verifies its identity, and rebuilds the action as `setCustomType` or `setCustomField` from that current Cart.
- A **Checkout Version Conflict** reports that the version-forward retry was exhausted.
- A **Checkout Cart Mismatch** prevents details submitted for one Cart from being applied to a different authoritative Checkout Cart.
- A **Checkout Mutation Failure** occurs when the selected **Contact Source** cannot provide required **Buyer Contact** details.
- A **Checkout Mutation Failure** occurs when the selected **Contact Source** is not allowed for the current **Checkout**.
- A **Checkout Mutation Failure** occurs when an **Address Book Reference** cannot resolve to a **Shipping Address**.
- An **Address Book** belongs to exactly one **Business Unit**, not to a customer.
- An **Address Book** contains **Address Book Entries** that can be saved for Shipping, Billing, or both.
- An **Address Book Entry** can independently carry Default Shipping and Default Billing flags.
- Default Shipping automatically includes the Shipping **Address Type**; Default Billing automatically includes the Billing **Address Type**.
- Saving an **Address Book Entry** accepts the address, its **Address Types**, and its **Default Address Flags**.
- An authenticated buyer can access an **Address Book** only while acting in its Business Unit **Buying Context**.
- An authenticated buyer authorized for a Business Unit **Buying Context** can list, select, and add addresses in that Business Unit's **Address Book**.
- **Current Address Book** owns request-scoped identity selection; the provider-neutral **Address Book** Service remains the process-level provider seam.
- The first Address Book capability does not define a separate address administrator role.
- **Checkout** consumes the **Address Book** as an external capability and does not own its addresses.
- A **Checkout Step Completion** is derived from current checkout details and is not stored independently.
- First-slice **Checkout Step** status is binary: complete or incomplete.
- The **Next Checkout Step** is the first incomplete **Checkout Step** in the step sequence.
- A **Checkout Step** after the **Next Checkout Step** is unavailable until earlier completion conditions are satisfied.
- A blocking **Cart Policy Violation** prevents Checkout from advancing to a step that assumes a purchasable Cart.
- **Contact** is complete when required **Buyer Contact** details are available to the current **Checkout** and the current buyer mode is allowed.
- Required **Buyer Contact** details are email address, first name, and last name.
- Phone number is optional **Buyer Contact**.
- Authenticated B2B **Checkout** also requires an eligible buyer and **Buying Context** before **Contact** is complete.
- For authenticated B2B **Checkout**, **Buyer Contact** alone is not sufficient to complete **Contact**.
- Resolving **Buying Context** is part of **Contact** when it is required for **Checkout**.
- **Buyer Contact** can be recorded for the **Cart** even when it is derived from a known buyer.
- Authenticated buyers can save **Buyer Contact** details that differ from their profile.
- **Contact Input** can be entered by the buyer or derived from the customer profile.
- **Contact Input** includes a **Contact Source** when more than one strategy can resolve **Buyer Contact**.
- **Manual** is the **Contact Source** for buyer-entered **Buyer Contact** details.
- **Customer Profile** is the **Contact Source** for **Buyer Contact** details derived from the current customer profile.
- **Contact Source** resolves a complete **Buyer Contact**; partial overrides are not part of the current Contact language.
- A **Contact Source Policy** can make a **Contact Source** unavailable for the current **Checkout**.
- **Checkout State** derives **Contact Source Policy** results from current details; stored carts are re-evaluated rather than migrated.
- A previously saved **Contact Source** that becomes disallowed no longer satisfies **Contact**.
- **Contact Source Policy** results are represented as **Contact** incompletion, not **Checkout Policy Violations**.
- **Buying Context** is not a **Contact Source** for **Buyer Contact**.
- Saving **Contact** submits the **Contact Inputs** needed to resolve **Contact** for the current **Checkout**.
- Saving **Contact** is a replacement-style **Checkout Mutation** and is allowed even when **Contact** is already complete.
- **Delivery Details** is complete when **Shipping Address** is present and structurally valid.
- **Delivery Details** follows **Contact** when delivery details are incomplete.
- **Manual** is the **Delivery Details Source** for buyer-entered **Shipping Address**.
- **Address Book** is the **Delivery Details Source** for **Shipping Address** resolved from a saved address, including an address saved during the current Delivery Details operation.
- Checkout offers only **Address Book Entries** whose **Address Types** include Shipping as Delivery Details choices.
- Saving a new address from **Delivery Details** can add it as Shipping and optionally make it Default Shipping.
- Billing use and Default Billing are selected during **Payment Options**, not **Delivery Details**.
- **Address Book** **Delivery Details Source** submits an **Address Book Reference** rather than a copied **Shipping Address**.
- A **Delivery Details Input** is either a Manual **Shipping Address** with optional save and Default Shipping preferences, or an existing **Address Book Reference**.
- For **Delivery Details**, the buyer can select an existing **Address Book** address or enter a new **Shipping Address**.
- A new **Shipping Address** remains Cart-only unless the buyer explicitly chooses to save it to the Business Unit **Address Book**.
- Saving a Manual **Shipping Address** to the **Address Book** assigns its new **Address Book Reference** internally; the buyer does not supply the identity of an entry that does not yet exist.
- A buyer-entered new **Shipping Address** uses the Manual **Delivery Details Source** only when it remains Cart-only; after it is saved to the **Address Book**, its persisted source is Address Book.
- Retrying the Cart update by its saved **Address Book Reference** preserves the Address Book source.
- Existing Address Book selection and new-address save both preserve saved identity on the complete Cart Shipping Address snapshot and expose the current **Address Book Reference** through Checkout Details.
- Saving a new Cart-only **Shipping Address** clears any previous current **Address Book Reference**.
- Saving a new **Shipping Address** to the Business Unit **Address Book** is never an implicit effect of saving **Delivery Details**.
- Saving a new address to the **Address Book** and using it for **Delivery Details** first persists the Business Unit address and then saves the resolved **Shipping Address** to the Cart.
- The Cart stores the complete resolved **Shipping Address**, not only its **Address Book Reference**, so Cart and Order consumers do not depend on a later Address Book lookup.
- If the Business Unit address is saved but the Cart update fails, saving the **Delivery Details** step fails and returns the saved **Address Book Reference** for retry.
- If the Cart update succeeds but the response-state read fails, the failure still returns the saved **Address Book Reference** so a transport caller does not repeat the Business Unit write.
- If the Cart write result cannot be confirmed, **Checkout Mutation Outcome Unknown** remains a client-recoverable failure and retains the saved **Address Book Reference** for refresh-based recovery.
- Retrying after that partial failure uses the existing-Address-Book **Delivery Details Input**, gets the canonical **Address Book Entry** by reference, and retries only the Cart update; retry is not a separate input kind.
- Address Book save idempotency is reference-based and does not compare address fields: an existing reference returns its canonical entry without another write.
- **Delivery Details** completion depends on the resolved **Shipping Address**, not on preserving an **Address Book Reference**.
- A later change to or removal of an **Address Book Entry** does not silently change or invalidate the Cart's resolved **Shipping Address**.
- Changing **Buying Context** requires a different **Cart**.
- A structurally valid **Shipping Address** can be saved even when it produces a **Checkout Policy Violation**.
- **Shipping Options** can be the **Next Checkout Step** and remain incomplete when blocking violations prevent selecting shipping.
- **Delivery Routing** produces one or more ranked **Delivery Plans**; plans can differ in their Delivery Groups and in the Shipping Options available to those groups.
- Each **Delivery Plan** has a **Delivery Plan Reference**, and every Delivery Group contains one or more explicit **Delivery Targets**.
- For each **Cart Line Item** in a Delivery Plan, its Delivery Target quantities are positive and sum exactly to the quantity currently requested in the Cart; no other Cart Line Item may be targeted.
- A one-shipment Checkout has one **Delivery Group**; a split Checkout has more than one.
- One **Delivery Plan** can offer more than one **Shipping Option** for the same Delivery Group.
- A **Delivery Plan** does not create physical Shipments, Order Deliveries, or Parcels.
- **Shipping Options** is complete only when every **Delivery Group** from the selected Delivery Plan has its **Selected Shipping Option** saved on the Cart and that selection still applies.
- Available **Shipping Options** are resolved for each Delivery Group within a Delivery Plan and are presented alongside **Checkout State**, not stored inside it.
- A buyer selects a **Delivery Plan** by its **Delivery Plan Reference** and one Shipping Option per Delivery Group by its **Shipping Option Reference**; the save resolves those references against the authoritative Current Cart rather than accepting copied allocations, prices, or promises.
- Saving the selected Delivery Plan's **Selected Shipping Options** is one replacement-style **Checkout Mutation** and is allowed when Shipping Options is already complete.
- Changing the Cart, its **Shipping Address**, or fulfillment constraints can change the **Delivery Plan** or available **Shipping Options**, which makes Shipping Options incomplete again until every Delivery Group has a current selection.
- No available **Shipping Options** is a valid availability result rather than a provider failure; Shipping Options remains incomplete.
- A **Checkout Policy Violation** can have one or more **Violation Targets**.
- A **Checkout Violation** can have one or more **Violation Targets**.
- A **Violation Target** can identify a **Checkout Step**, a Cart item, or the whole **Cart**.
- **Payment Method** includes Net Terms, store credit, and card payment; supporting several available methods does not imply split tender.
- Each **Payment Method** determines its own **Payment Method Eligibility** from the current buyer context.
- An ineligible **Payment Method** is omitted from **Payment Options**; an eligible Payment Method remains eligible when its **Payment Method Funding Capacity** is partial or none.
- Net Terms **Payment Method Eligibility** requires an approved Business Unit **Credit Profile**. Its **Payment Method Funding Capacity** is assessed from the current Cart amount and available credit and is reassessed when Net Terms is saved.
- Payment Options currently permits selecting an eligible Payment Method only when it can fund the full Cart amount; retaining partial funding capacity allows a future Checkout to allocate the shortfall to another Payment Method.
- **Payment Options** saves one **Prepared Payment** for the current **Cart** and does not perform **Payment Authorization**.
- A card **Prepared Payment** can be initialized before authorization so the buyer can enter payment details securely; initialization is not **Payment Authorization**.
- The **Prepared Payment** and current **Cart** must agree on amount and currency before **Payment Authorization**.
- A **Prepared Payment** is updated when the Cart amount changes; an authorized Payment is not silently changed to match a new Cart amount.
- **Payment Authorization** begins inside an **Order Placement Attempt** after the buyer chooses Place Order.
- **Payment Capture** occurs only after the Order has been placed.

## Example Dialogue

> **Dev:** "Should we save that the shipping step is complete?" **Domain expert:** "No — **Checkout Step Completion** is derived from the current checkout details, because address or cart changes can make a completed step incomplete again."

> **Dev:** "Does Checkout have its own stored state?" **Domain expert:** "No — **Checkout State** is derived from the current **Cart** and buyer context."

> **Dev:** "Does saving Delivery Details return and store a new Checkout State?" **Domain expert:** "No — saving Delivery Details is a **Checkout Mutation**; **Checkout State** is recomputed from the updated **Cart**."

> **Dev:** "Is a provider outage a Checkout Policy Violation?" **Domain expert:** "No — a provider outage deliberately classified as recoverable is a **Checkout Mutation Failure** when it prevents saving details. Provider contract violations are defects, not buyer-facing policy or mutation failures."

> **Dev:** "If the same Delivery Details are submitted twice, should that create duplicate checkout details?" **Domain expert:** "No — replacement-style **Checkout Mutations** are idempotent for the same requested details."

> **Dev:** "Can a buyer start Checkout without a Cart?" **Domain expert:** "No — **Checkout** requires an existing non-empty **Cart**."

> **Dev:** "Should we reject an Alaska shipping address if the current cart contains an item that cannot ship to Alaska?" **Domain expert:** "No — save the structurally valid **Shipping Address**, then show the resulting **Checkout Policy Violation** in **Checkout State**."

> **Dev:** "If Delivery Details are saved but shipping cannot continue because of a policy violation, do we reopen Delivery Details?" **Domain expert:** "No — **Shipping Options** becomes the **Next Checkout Step** and remains incomplete while the blocking violation prevents selecting shipping."

> **Dev:** "Does Delivery Details only support manually entered addresses?" **Domain expert:** "No — first design includes **Manual** and **Address Book** as **Delivery Details Sources**."

> **Dev:** "When saving Delivery Details from Address Book, do we submit a copied Shipping Address?" **Domain expert:** "No — submit an **Address Book Reference** and let the save operation resolve the **Shipping Address** for the **Cart**."

> **Dev:** "Does Delivery Details completion require preserving the Address Book Reference?" **Domain expert:** "No — completion depends on the resolved **Shipping Address** saved for the **Cart**."

> **Dev:** "If an Address Book Reference resolves to a structurally valid address that violates checkout policy, should Delivery Details still save it?" **Domain expert:** "Yes — save the structurally valid **Shipping Address**, then derive the resulting **Checkout Violation** in **Checkout State**."

> **Dev:** "If an Address Book Reference is stale or inaccessible, should Delivery Details save and remain incomplete?" **Domain expert:** "No — saving **Delivery Details** fails with a **Checkout Mutation Failure** because the **Shipping Address** cannot be resolved."

> **Dev:** "Should Checkout Step status include blocked?" **Domain expert:** "No — first-slice **Checkout Step** status is binary, and the **Next Checkout Step** is the first incomplete step."

> **Dev:** "Do blocking violations always belong to a Checkout Step?" **Domain expert:** "No — blocking violations are global in **Checkout State** and can target a **Checkout Step**, a Cart item, or the whole **Cart**."

> **Dev:** "If two products cannot be purchased together, should both line items always be marked invalid?" **Domain expert:** "No — the violation can target the **Cart** instead of individual line items when the buyer chooses which item to remove."

> **Dev:** "Does a Cart Policy become a Checkout Policy when Checkout shows it?" **Domain expert:** "No — a **Cart Policy Violation** can block Checkout progress, but it remains about the **Cart** being purchasable as composed."

> **Dev:** "Is invoice payment a special arrangement outside payment?" **Domain expert:** "No — invoice terms are a **Payment Method**."

> **Dev:** "Should the checkout step be called Payment Methods?" **Domain expert:** "No — **Payment Options** is the buyer-facing step; **Payment Methods** are what the buyer selects."

> **Dev:** "If the buyer is already signed in, do we still show **Contact**?" **Domain expert:** "Only if required contact details or buyer context are incomplete; otherwise **Contact** is already complete and Checkout advances to the next incomplete step."

> **Dev:** "If the buyer is already signed in, should saving Contact fail because the contact details are derived?" **Domain expert:** "No — saving **Contact** can record or replace derived **Buyer Contact** details for the **Cart**, and repeated saves are idempotent."

> **Dev:** "If an authenticated buyer changes the cart contact email, does that change who the buyer is?" **Domain expert:** "No — **Buyer Contact** is order communication detail; it does not change the authenticated buyer or **Buying Context**."

> **Dev:** "If the buyer profile has an email, but the current Checkout does not yet have required Buyer Contact details, is Contact complete?" **Domain expert:** "No — **Contact** is complete when required **Buyer Contact** details are available to the current **Checkout**, not merely known elsewhere about the buyer."

> **Dev:** "Is email enough to complete Contact?" **Domain expert:** "No — required **Buyer Contact** details are email address, first name, and last name; phone number is optional."

> **Dev:** "After signing in, what happens to the anonymous Cart?" **Domain expert:** "It remains a Store-only anonymous **Cart**. Authenticated B2B **Checkout** resolves a separate Cart for the Store and **Buying Context** Business Unit."

> **Dev:** "If Buyer Contact is available after sign-in, but Buying Context is unresolved, can authenticated Checkout start?" **Domain expert:** "No — authenticated B2B **Checkout Scope** requires **Buying Context** so it can select the Cart for the Store and Business Unit."

> **Dev:** "What happens when the authenticated buyer's Buying Context cannot be resolved?" **Domain expert:** "Authenticated B2B **Checkout Scope** cannot be constructed. Checkout does not fall back to or merge the anonymous Cart."

> **Dev:** "Does saving Contact always mean submitting email, first name, and last name fields typed by the buyer?" **Domain expert:** "No — saving **Contact** submits the **Contact Inputs** needed to resolve **Contact**; those inputs can be entered manually or derived from the customer profile."

> **Dev:** "Does Checkout State expose profile email choices or address book entries?" **Domain expert:** "No — **Checkout State** is a lean read model of current **Checkout Details**; option lists come from separate capabilities before they are saved to the **Cart**."

> **Dev:** "Should Checkout State fail schema decoding when Contact is incomplete?" **Domain expert:** "No — the **Checkout Read Schema** can represent ordinary incomplete **Checkout**; stricter **Checkout Action Schemas** enforce details required by specific actions."

> **Dev:** "Should Checkout State explain why every incomplete step is incomplete?" **Domain expert:** "Not in the first slice — first-slice **Checkout State** reports step status and current details, not structured incompletion reasons."

> **Dev:** "After saving Contact, do we record a source for each contact field?" **Domain expert:** "No — **Contact Source** is the selected strategy for resolving **Buyer Contact**, not field-level provenance."

> **Dev:** "Can Buying Context be a Contact Source?" **Domain expert:** "No — **Buying Context** may be required for authenticated B2B **Checkout**, but it is not a **Contact Source** for **Buyer Contact**."

> **Dev:** "Should the buyer-entered Contact Source be called Guest?" **Domain expert:** "No — the **Contact Source** is **Manual**; guest describes buyer mode, not how **Buyer Contact** is resolved."

> **Dev:** "Can Customer Profile Contact Source include a manual email override?" **Domain expert:** "Not now — **Contact Source** resolves a complete **Buyer Contact**; partial overrides are not part of the current Contact language."

> **Dev:** "If Customer Profile is selected but the profile lacks a required contact detail, should Contact save and remain incomplete?" **Domain expert:** "No — saving **Contact** fails with a **Checkout Mutation Failure** because the selected **Contact Source** cannot resolve required **Buyer Contact**."

> **Dev:** "Should Checkout State include every possible Contact Source option?" **Domain expert:** "No — **Checkout State** reports whether the current **Contact Source** satisfies **Contact**; selectable options are not owned by **Checkout State** until saved."

> **Dev:** "If the store later disallows Manual Contact Source for authenticated customers, do older carts need a migration?" **Domain expert:** "No — **Checkout State** is derived again from current details and **Contact Source Policy** results."

> **Dev:** "If a client submits Manual Contact Source when Manual is not allowed, should Checkout save it and show a policy violation?" **Domain expert:** "No — saving **Contact** fails with a **Checkout Mutation Failure** because the selected **Contact Source** is not allowed."

> **Dev:** "If a cart already has Manual Buyer Contact and Manual later becomes disallowed, is Contact still complete?" **Domain expert:** "No — the previously saved **Contact Source** no longer satisfies **Contact**, and **Checkout State** reports **Contact** as incomplete."

> **Dev:** "Is disallowed Manual Contact Source a Checkout Policy Violation?" **Domain expert:** "No — it is represented as **Contact** incompletion, not as a **Checkout Policy Violation**."

> **Dev:** "Should Checkout State keep Cart Policy Violations and Checkout Policy Violations in separate lists?" **Domain expert:** "No — **Checkout State** includes one global list of **Checkout Violations**, while preserving whether each violation came from **Cart Policy** or **Checkout Policy**."

> **Dev:** "Do first-slice Checkout Violations need warning/advisory severity?" **Domain expert:** "No — first-slice **Checkout Violations** are blocking."

> **Dev:** "Is signing in enough for B2B Checkout?" **Domain expert:** "No — **Contact** also needs the **Buying Context** the buyer is acting within."

> **Dev:** "Can the buyer switch Buying Context during Checkout?" **Domain expert:** "Yes — changing **Buying Context** changes the **Current Cart**, so Checkout must be rebuilt for the new context. Another active **Cart** yields its Checkout; no active **Cart** means Checkout is unavailable. Previously shown Checkout State must never be reused."

## Flagged Ambiguities

- "open step" was used near UI state — resolved: which step is presented belongs to the user interface; the domain reports the **Next Checkout Step**.
- "buyer identification" was used for the first step — resolved: **Contact** is the Checkout Step; **Buying Context** and **Buyer Contact** are details that can satisfy it.
- "context step" was used near contact collection — resolved: the Checkout Step is **Contact** unless the discussion is specifically about choosing **Buying Context**.
- "contact information" was used to include shipping address — resolved: **Contact** owns buyer contact details, while **Delivery Details** owns **Shipping Address**.
- "cart policy" was used for address-dependent restrictions — resolved: rules that depend on checkout details such as **Shipping Address** are **Checkout Policies**, even when their violations are displayed beside cart items.
- "account" and "company" were used near buyer selection — resolved: **Business Unit** names a company or division, **Business Unit Membership** names a Customer's eligible relationship, and **Buying Context** names the verified Business Unit selected for the current Store request.

## Promotions

Core represents discount codes (including native applicability), observed Cart discount allocations and native subtotals/totals. `CurrentCart.changeDiscountCode` uses the same selected buyer, Store, Cart ownership and policy checks as quantity changes. Adapters own code validation, automatic discounts, stacking and eligibility. The Cart page and flyout share connected promotion controls; the design system receives presentation props and slots. Totals come from the provider, not unit-price multiplication. Catalog sale prices are separate from Cart promotions: Product Cards pair an effective starting price with an optional higher reference price for that same variant. Search sorting uses the effective indexed price for the selected audience, not a hypothetical coupon-adjusted price.

Cart Tax is a native observation: known, estimated or unknown, with an amount and price inclusion when available. Missing Tax information means unknown. Cart `totalPrice` is the gross payable total once calculated; `totalPriceEstimated` identifies incomplete totals. Merchandise subtotals retain their native tax treatment, so included Tax is displayed without adding it again. Application-managed Checkout requires known Tax before preparing or saving Payment Options, and the provider revalidates the gross amount before authorization and Order placement. Hosted Checkout may finalize Tax after the handoff.

Core owns portable Tax Class inputs and explicit catalog Product assignments. Optional CLI tax setup composes these with provider-owned configuration through the existing Migrate pipeline, resolving published Product IDs before writes. Commercetools maps classifications to native Tax Categories and jurisdiction rates, including explicit Shipping Method assignments. Shopify maps classifications to product taxability and optional native taxonomy categories, and checks expected shop tax settings. Tax collection registrations remain Shopify Admin configuration. Tax jurisdictions and rate tables are never inferred from locale, Store or currency. See [Tax setup](provisioning/README.md#tax-setup).
