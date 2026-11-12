@commerce @shopify-b2c @checkout @web
Feature: Shopify B2C Checkout

  Buyers can take their Cart to Shopify Checkout as guests or as signed-in Customers.

  Background:
    Given Product "Trail jacket" is available for purchase
    And I am shopping as a guest

  Scenario: A guest places an Order with the first item added to their Cart
    When I open the Product Detail Page for "Trail jacket"
    And the buyer selects the Product Variant with attributes:
      | Attribute | Value |
      | Size      | M     |
      | Color     | Red   |
    And the buyer adds 1 unit of the selected Product Variant to their Cart
    Then the Cart is open with 1 unit of Product "Trail jacket"
    When I proceed to Checkout from the Cart
    Then Shopify Checkout shows 1 unit of Product "Trail jacket" with options:
      | Option | Value |
      | Size   | M     |
      | Color  | Red   |
    When I enter Contact and Delivery Details in Shopify Checkout:
      | Field       | Value                        |
      | Email       | shopify-checkout@example.com |
      | First name  | Taylor                       |
      | Last name   | Rivera                       |
      | Address     | 350 5th Avenue               |
      | City        | New York                     |
      | State       | NY                           |
      | Postal code | 10118                        |
      | Country     | US                           |
    And I pay with a test Card in Shopify Checkout
    Then Shopify Order Confirmation shows 1 unit of Product "Trail jacket"

  Scenario: A Customer keeps their guest Cart when they sign in and check out
    Given "Taylor Rivera" has a Customer Account
    When I open the Product Detail Page for "Trail jacket"
    And the buyer selects the Product Variant with attributes:
      | Attribute | Value |
      | Size      | M     |
      | Color     | Red   |
    And the buyer adds 1 unit of the selected Product Variant to their Cart
    And I log in as "Taylor Rivera"
    And I open the Cart
    And I proceed to Checkout from the Cart
    Then Shopify Checkout shows 1 unit of Product "Trail jacket" with options:
      | Option | Value |
      | Size   | M     |
      | Color  | Red   |
    And Shopify Checkout shows the email for Customer "Taylor Rivera"
