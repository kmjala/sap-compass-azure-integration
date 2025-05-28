// See https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger?tabs=python-v2%2Cisolated-process%2Cnodejs-v4%2Cextensionv5&pivots=programming-language-typescript

import { app, InvocationContext } from "@azure/functions";
import { MyContainerClient } from "../../message-archive-client";
import { getServiceBusSender } from "../../service-bus-client";
import { sanitizeFilename } from "../sanitize-filename";
import {
  CompassMessage,
  PlantData,
  SAPMessage,
} from "./material-master-to-compass.d";
import {
  isCompass1Plant,
  plantConversions,
  uomConversions,
} from "../../conversions/conversion-table";
import { populateTraceContext } from "../trace-context";
import { isMaterialMesRelevant } from "../is-material-mes-relevant";
import { has1017CompassClassCharacteristic } from "../has-1017-compass-class-assignment";

const functionName = "material-master-to-compass";
// This topic name must match the name in https://github.com/goreperformancesolution/sap-integration-azure-infrastructure
const topic = "material-master-v1-topic";

/**
 * Registers this function to listen to the SAP Service Bus Material Master topic
 */
app.serviceBusTopic(functionName, {
  connection: "SapServiceBusConnection",
  topicName: topic,
  // This subscription name must match the name in https://github.com/goreperformancesolution/sap-integration-azure-infrastructure
  subscriptionName: `${topic}-compass`,
  handler: handler,
  cardinality: "one",
  isSessionsEnabled: true,
});

/**
 * Processes the incoming message from the SAP Service Bus topic
 */
export async function handler(
  message: unknown,
  context: InvocationContext,
): Promise<void> {
  // Add the metadata to the logs for easier troubleshooting
  populateTraceContext(context);
  let inputMessage = message as SAPMessage;
  context.traceContext.attributes.materialNumber = `${inputMessage.Product}`;
  context.traceContext.attributes.mesMessageType =
    "ERPProductNew ERPProductChange";
  context.traceContext.attributes.plant = `${inputMessage.PlantData?.map((p) => p.Plant).join(" ")}`;
  context.info("Trace context attributes", context.traceContext.attributes);

  // Archive the incoming message
  const containerClient = new MyContainerClient(context, functionName);
  const inputBlobName = await containerClient.upload(message, "input.json");
  const inputBlobLink = containerClient.getBrowserLink(inputBlobName);
  context.info(
    `Archived incoming SAP Material Master message at ${inputBlobLink}`,
  );

  if (typeof message !== "object") {
    throw new Error("Invalid input message, check the file content");
  }

  if (!inputMessage.PlantData) {
    context.info("Skipping message because it does not contain plant data");
    return;
  }

  // Remove non-MES-relevant materials
  if (!isMaterialMesRelevant(inputMessage.ProductClass)) {
    context.info(
      `Skipping Material ${inputMessage.Product} because it is not MES relevant.`,
    );
    return;
  }

  // Remove non-Compass plants
  inputMessage = await removeInvalidPlants(
    inputMessage,
    context,
    containerClient,
  );

  if (inputMessage.PlantData.length === 0) {
    context.info("Skipping this message, no valid plants found");
    return;
  }

  // Archive the XML file used to create/update the record in Compass
  context.info("Creating Compass XML messages");
  const outputMessages: CompassMessage[] = [];
  for (const plant of inputMessage.PlantData) {
    const outputMessage = await createOutputMessage(
      inputMessage,
      plant,
      containerClient,
      context,
    );
    outputMessages.push(outputMessage);

    context.info(`Archived XML files for plant '${outputMessage.Plant}'`);
  }

  // Send the message to Compass
  context.info("Sending messages to Compass");
  for (const message of outputMessages) {
    const queueName = getQueueNameForPlant(message);
    await getServiceBusSender(queueName).sendMessages({
      body: message,
      contentType: "application/json",
      correlationId: context.traceContext.attributes.correlationId,
      sessionId: `${message.MaterialNumber}`,
    });
  }
  context.info(`Sent ${outputMessages.length} message(s) to Compass`);
}

/**
 * We have two Compass instances, each listening to their own queue. This
 * function determines which queue to send the message to.
 *
 * @returns The name of the Service Bus queue for the given plant
 */
function getQueueNameForPlant(message: CompassMessage) {
  // Special case for APN: Use queue for Compass2
  if (message.Plant === "B024") {
    return "material-master-to-compass";
  }

  // All other plants use Compass1
  return "material-master-to-compass1";
}

/**
 * @returns input message with invalid plants removed
 */
async function removeInvalidPlants(
  input: SAPMessage,
  context: InvocationContext,
  containerClient: MyContainerClient,
) {
  const validPlants = input.PlantData.map(async (plant) => {
    const isValid = await isPlantValid(plant, input, context, containerClient);
    return isValid ? plant : null;
  });
  const resolvedValidPlants = await Promise.all(validPlants);
  input.PlantData = resolvedValidPlants.filter((plant) => plant !== null);
  return input;
}

/**
 * @returns true if the plant is valid for Compass
 */
async function isPlantValid(
  plant: PlantData,
  input: SAPMessage,
  context: InvocationContext,
  containerClient: MyContainerClient,
) {
  // Skip plants that are not Compass1 or Compass2 plants
  if (!plantConversions.hasCompassValue(plant.Plant)) {
    context.info(
      `Skipping plant '${plant.Plant}' because it is not a Compass plant`,
    );
    return false;
  }

  // Skip plants that do not have a G3 profile code
  if (plant.ProfileCode !== "G3") {
    context.info(
      `Skipping plant '${plant.Plant}' because it does not have a G3 profile code`,
    );
    return false;
  }

  // Unless enabled, skip messages bound for Compass1
  // TODO Remove this post go-live of Compass1
  if (
    isCompass1Plant(plant.Plant) &&
    process.env.ENABLE_SAP_TO_COMPASS1 !== "true"
  ) {
    context.info(
      `Skipping Compass1 plant '${plant.Plant}' because Compass1 is not yet enabled (ENABLE_SAP_TO_COMPASS1 environment variable is not 'true')`,
    );
    return false;
  }

  // If it is not for 1017, then no further checks are needed and it is a valid plant
  if (plant.Plant !== "1017") {
    return true;
  }

  // Plant 1017 is special: It is mapped to multiple plants (Compass and non-Compass).
  // Use the MES_SYSTEM class characteristic to determine if it is for Compass.
  const hasCompassCharacteristic = await has1017CompassClassCharacteristic(
    input.Product,
    context,
    containerClient,
  );
  if (!hasCompassCharacteristic) {
    context.info(
      `Skipping plant '${plant.Plant}' because MES_SYSTEM class characteristic indicates that it is not for Compass`,
    );
    return false;
  }

  return true;
}

/**
 * @returns the message to be sent to Compass
 */
async function createOutputMessage(
  input: SAPMessage,
  plant: PlantData,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<CompassMessage> {
  const compassPlant = plantConversions.getCompassValue(plant.Plant);
  const englishDescription = input.ProductDescription.find(
    (description) => description.Language === "EN",
  );
  if (!englishDescription) {
    throw new Error("No english description found");
  }

  // Create the "create" XML file and upload it to the Azure Blob Storage
  const createXmlBlob = createCreateXml(
    input.Product,
    englishDescription.ProductDescription,
    input.BaseUnitISOCode,
  );
  const createXmlBlobPath = await containerClient.upload(
    createXmlBlob,
    `create-${compassPlant}.xml`,
  );
  const createXmlBlobLink = containerClient.getBrowserLink(createXmlBlobPath);
  context.info(
    `Archived Compass XML to create a new material for plant '${compassPlant}' at ${createXmlBlobLink}`,
  );

  // Create the "update" XML file and upload it to the Azure Blob Storage
  const updateXmlBlob = createUpdateXml(
    input.Product,
    englishDescription.ProductDescription,
    input.BaseUnitISOCode,
    plant.CountryOfOrigin,
  );
  const updateXmlBlobPath = await containerClient.upload(
    updateXmlBlob,
    `update-${compassPlant}.xml`,
  );
  const updateXmlBlobLink = containerClient.getBrowserLink(updateXmlBlobPath);
  context.info(
    `Archived Compass XML to update an existing material for plant '${compassPlant}' at ${updateXmlBlobLink}`,
  );

  const outputMessage = {
    MaterialNumber: input.Product,
    Plant: compassPlant,
    Filename: sanitizeFilename(
      `MM-${input.Product}-${compassPlant}-${context.triggerMetadata?.messageId}.xml`,
    ),
    CreateXmlBlob: createXmlBlobPath,
    UpdateXmlBlob: updateXmlBlobPath,
  };
  await containerClient.upload(outputMessage, "compass-message.json");
  return outputMessage;
}

/**
 * @returns XML file used to create the record in Compass
 */
function createCreateXml(product: string, description: string, uom: string) {
  const compassUom = uomConversions.getCompassValue(uom);

  return `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ERPProductNew">
  <ProductInfo>
    <Product><![CDATA[${product}]]></Product>
    <Revision>1</Revision>
    <ERPDescription><![CDATA[${description}]]></ERPDescription>
    <PrimaryUOM>${compassUom}</PrimaryUOM>
    <ProductType>UNMODELED</ProductType>
    <NonAccretiveIssue>True</NonAccretiveIssue>
    <LotControlled>True</LotControlled>
  </ProductInfo>
</Root>
`;
}

/**
 * @returns XML file used to update an existing record in Compass
 */
function createUpdateXml(
  product: string,
  description: string,
  uom: string,
  countryOfOrigin: string,
) {
  const compassUom = uomConversions.getCompassValue(uom);

  return `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ERPProductChange">
  <ProductInfo>
    <Product><![CDATA[${product}]]></Product>
    <Revision>1</Revision>
    <ERPDescription><![CDATA[${description}]]></ERPDescription>
    <PrimaryUOM>${compassUom}</PrimaryUOM>
    <CountryOfOrigin>${countryOfOrigin}</CountryOfOrigin>
  </ProductInfo>
</Root>
`;
}
