Feature: Goods Receipt to SAP

  Scenario: Inventory was created
    Given a production operation has been partially or fully completed
    And inventory was created
    When the SuperBackFlush XML is written to the Compass output folder
    Then the translations from "goods-receipt.xlsx" are applied
    And the inventory is received in SAP
    And the transaction manager shows the transaction as completed

  Scenario: Inventory was not created
    Given a production operation has been partially or fully completed
    But no inventory was created
    When the SuperBackFlush XML is written to the Compass output folder
    Then no inventory was received in SAP

  Scenario: Some inventory was created
    Given several production operation has been partially or fully completed
    And an several operations have created inventory
    But several other operations have not created any inventory
    When the SuperBackFlush XML is written to the Compass output folder
    Then the translations from "goods-receipt.xlsx" are applied
    And the inventory is received in SAP for all operations that created inventory
    And no inventory is received in SAP for any operations that did not create inventory
    And the transaction manager shows the transaction as completed

  Scenario: Error encountered when receiving inventory in SAP
    Given a production operation has been partially or fully completed
    And inventory was created
    And the SAP down
    When the SuperBackFlush XML is written to the Compass output folder
    Then no inventory is received in SAP
    And the transaction manager shows the transaction as failed
