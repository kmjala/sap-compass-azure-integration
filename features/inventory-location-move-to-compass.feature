Feature: Inventory Location Move to Compass

  As inventory location moves happen in SAP, they trigger events in SAP, which
  are used to propagate the changes down to Compass.

  Scenario: Inventory Location Move event occurs in SAP
    When the event arrives in the Azure SAP topic
    Then translations from the "Inventory Location Move" sheet in "inventory-location-move-to-compass.xslx" are applied
    And Inventory Location Move status translations from "inventory-location-move-status.csv" are applied
    And the translated file is created in the Compass input folder
