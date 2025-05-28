Feature: Inventory Location Move to Compass

  As inspection lots are created in SAP, they trigger events in SAP, which
  are used to propagate the changes down to Compass.

  Scenario: Inspection Lot event occurs in SAP
    When the event arrives in the Azure SAP topic
    Then the translations from "production-order-confirmation.xlsx" are applied
    And the translated file is created in the Compass input folder
