Feature: Production Order Confirmation to SAP

  Scenario: Inventory was created
    Given a production operation has been partially or fully completed
    But no inventory was created
    When the SuperBackFlush XML is written to the Compass output folder
    Then the translations from "production-order-confirmation.xlsx" are applied
    And the Production Order is confirmed in SAP
    And the transaction manager shows the transaction as completed

  Scenario: Inventory was not created
    Given a production operation has been partially or fully completed
    And inventory was created
    When the SuperBackFlush XML is written to the Compass output folder
    Then the Production Order is not confirmed in SAP

  Scenario: Some inventory was created
    Given several production operation has been partially or fully completed
    And an several operations have created inventory
    But several other operations have not created any inventory
    When the SuperBackFlush XML is written to the Compass output folder
    Then the translations from "production-order-confirmation.xlsx" are applied
    And the Production Order was not confirmed in SAP for all operations that created inventory
    And the Production Order is confirmed in SAP for any operations that did not create inventory
    And the transaction manager shows the transaction as completed

  Scenario: Error encountered when confirming the Production Order in SAP
    Given a production operation has been partially or fully completed
    And the SAP down
    When the SuperBackFlush XML is written to the Compass output folder
    Then the Production Order is not confirmed in SAP
    And the transaction manager shows the transaction as failed
