Feature: Component Goods Issues to SAP

  Scenario: Component Goods Issue operation in Compass
    Given a Component Goods Issue operation has been completed in Compass
    And the plant is listed in "plant.csv"
    When the Work Order Issues XML is created and written to the Compass output folder
    Then translations from "components-goods-issues-to-sap.xlsx" are applied
    And the Production Order is confirmed in SAP
    And the transaction manager shows the transaction as completed

  Scenario: Skip processing for unmapped plants
    Given a Component Goods Issue operation has been completed in Compass
    And the plant is not listed in "plant.csv"
    When the Work Order Issues XML is created and written to the Compass output folder
    Then the Production Order is not confirmed in SAP
    And the transaction manager shows the transaction as completed

  Scenario: Stop processing when fields are inconsistent
    Given a Component Goods Issue operation has been completed in Compass
    And the Order id or Order Operation are not the same in each transaction
    When the Work Order Issues XML is created and written to the Compass output folder
    Then the Production Order is not confirmed in SAP
    And the transaction manager shows the transaction as failed

  Scenario: Stop processing when no reservation with variable quantity is found
    Given a Component Goods Issue operation has been completed in Compass
    And no reservation with variable quantity is found for the production order
    When the Work Order Issues XML is created and written to the Compass output folder
    Then the Production Order is not confirmed in SAP
    And the transaction manager shows the transaction as failed

  Scenario: Error encountered when confirming the Production Order in SAP
    Given a Component Goods Issue operation has been completed in Compass
    And SAP is down
    When the Work Order Issues XML is created and written to the Compass output folder
    Then the Production Order is not confirmed
    And the transaction manager shows the transaction as failed
