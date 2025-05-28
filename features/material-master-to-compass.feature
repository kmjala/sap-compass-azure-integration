Feature: Material Master to Compass

  As Material Master records are created or modified in SAP, they trigger
  events in SAP, which are used to propagate the changes down to Compass.

  Scenario: Material Master event occurs in SAP without a corresponding record in Compass
    Given a Material Master event from SAP
    And the Material Master record does not exist in Compass
    When the event arrives in the Azure SAP topic
    Then translations for the "update" XML from the "material-master.xlsx" are applied
    And the translated file is created in the Compass input folder

Scenario: Material Master event occurs in SAP for an existing record in Compass
    Given a Material Master event from SAP
    And the Material Master record does exist in Compass
    When the event arrives in the Azure SAP topic
    Then translation for the "update" XML from the "material-master.xlsx" is applied
    And the translated file is created in the Compass input folder

  Scenario: SAP messages for multiple Compass plants
    Given a Material Master event from SAP
    And multiple plants are specified in the event
    When the event arrives in the Azure SAP topic
    Then one file for each plant is created in the Compass CIO input folder

  Scenario: Create no files when no plant uses Compass
    Given a Material Master event from SAP
    And none of the plants that are specified in the event use Compass
    When the event arrives in the Azure SAP topic
    Then no files are created in the Compass CIO input folder

  Scenario: Skip plants that do not use Compass
    Given a Material Master event from SAP
    And some plants specified in the event don't use Compass as indicated by the "plant.csv" file
    And some other plants specified in the event use Compass as indicated by the "plant.csv" file
    When the event arrives in the Azure SAP topic
    Then only files for plants that use Compass are created in the Compass CIO input folder

  Scenario: Fail when no english description exists
    Given a Material Master event from SAP
    And the event does not contain a description in English
    When the event arrives in the Azure SAP topic
    Then the integration fails
