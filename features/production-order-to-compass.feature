Feature: Production Order to Compass

  As production orders are created or modified in SAP, they trigger events in
  SAP, which are used to propagate the changes down to Compass.

  Scenario: BOR exists in Compass
    When the event arrives in the Azure SAP topic
    And the BOR exists in Compass
    Then translations from "production-order.xslx" are applied
    And the "Production Order Operations (Update XML)" file is created in the Compass input folder
    And the Production Order XML file is created in the Compass input folder afterwards

  Scenario: BOR does not exist in Compass
    When the event arrives in the Azure SAP topic
    And the BOR does not exist in Compass
    Then translations from "production-order.xslx" are applied
    And the "Production Order Operations (Create XML)" file is created in the Compass input folder
    And the Production Order XML file is created in the Compass input folder afterwards

  Scenario: Production Order exists in Compass
    When the event arrives in the Azure SAP topic
    And the Production Order exists in Compass
    Then translations from "production-order.xslx" are applied
    And the Production Order Operations XML file is created in the Compass input folder
    And the "Production Order (Update XML)" file is created in the Compass input folder afterwards

  Scenario: Production Order does not exist in Compass
    When the event arrives in the Azure SAP topic
    And the Production Order does not exist in Compass
    Then translations from "production-order.xslx" are applied
    And the Production Order Operations XML file is created in the Compass input folder
    And the "Production Order (Create XML)" file is created in the Compass input folder afterwards

  Scenario: Deleted Production Order Operation
    When the event arrives in the Azure SAP topic
    And the Production Order has an Operation that has been deleted
    Then the deleted Production Order Operation is not sent to Compass

  Scenario: Combine fixed and variable quantity of the same Production Order Component
    Given a Production Order with several Components
    And some components entries are for the same component but once with fixed and once with variable quantity
    When the event arrives in the Azure SAP topic
    Then the XML only has a single entry for each physical Production Order Component
    And the fixed and variable quantities for the same physical component are combined

  Scenario: Filter out non-consumable components
    Given a Production Order with several Components
    And some components are non-consumable
    When the event arrives in the Azure SAP topic
    Then the non-consumable components are not sent to Compass
