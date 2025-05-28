// See https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger?tabs=python-v2%2Cisolated-process%2Cnodejs-v4%2Cextensionv5&pivots=programming-language-typescript

import { app, InvocationContext } from "@azure/functions";
import { MyContainerClient } from "../../message-archive-client";
import { getServiceBusSender } from "../../service-bus-client";
import { SAPMessage } from "./inventory-location-move-to-compass.d";
import {
  inventoryLocationMoveStatusConversions,
  isCompass1Plant,
  plantConversions,
  uomConversions,
} from "../../conversions/conversion-table";
import { sanitizeFilename } from "../sanitize-filename";
import { populateTraceContext } from "../trace-context";
import { isMaterialMesRelevant } from "../is-material-mes-relevant";
import { has1017CompassClassCharacteristic } from "../has-1017-compass-class-assignment";

const functionName = "inventory-location-move-to-compass";
// This topic name must match the name in https://github.com/goreperformancesolution/sap-integration-azure-infrastructure
const topic = "inventory-location-move-v1-topic";

/**
 * Registers this function to listen to the SAP Service Bus Inventory Location Move topic
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
  const inputMessage = message as SAPMessage;
  context.traceContext.attributes.batch = `${inputMessage.Batch?.Batch}`;
  context.traceContext.attributes.location = `${inputMessage.EWMStorageBin}`;
  context.traceContext.attributes.materialNumber = `${inputMessage.Product?.Product}`;
  context.traceContext.attributes.mesMessageType = "ipdERPLotMasterUpdate";
  context.traceContext.attributes.plant = `${inputMessage.EWMWarehouse}`;
  context.info("Trace context attributes", context.traceContext.attributes);

  // Archive the incoming message
  const containerClient = new MyContainerClient(context, functionName);
  const inputBlobName = await containerClient.upload(message, "input.json");
  const inputBlobLink = containerClient.getBrowserLink(inputBlobName);
  context.info(
    `Archived incoming SAP Inventory Location Move message at ${inputBlobLink}`,
  );

  if (typeof message !== "object") {
    throw new Error("Invalid input message, check the file content");
  }

  if (!inputMessage.Batch) {
    context.info("Skipping message because it does not contain a Batch");
    return;
  }

  // Remove non-MES-relevant materials
  if (!isMaterialMesRelevant(inputMessage.Product.ProductClass)) {
    context.info(
      `Skipping Material ${inputMessage.Product.Product} because it is not MES relevant.`,
    );
    return;
  }

  // Ignore non-Compass messages
  const isValidPlantResult = await isValidPlant(
    inputMessage,
    context,
    containerClient,
  );
  if (!isValidPlantResult) {
    return;
  }

  // Archive the XML file sent to Compass
  context.info("Creating Compass XML message");
  const xml = createXml(inputMessage);

  const blobName = await containerClient.upload(xml, "update.xml");
  const link = containerClient.getBrowserLink(blobName);
  context.info(`Archived Compass Inspection Lot XML at ${link}`);

  // Send the message to Compass
  context.info("Sending message to Compass");
  const compassMessage = {
    Plant: plantConversions.getCompassValue(inputMessage.EWMWarehouse),
    Batch: inputMessage.Batch.Batch,
    Filename: sanitizeFilename(
      `IM-${inputMessage.Batch.Batch}-${context.triggerMetadata?.messageId}.xml`,
    ),
    UpdateXmlBlob: blobName,
  };
  await containerClient.upload(compassMessage, "compass-message.json");

  const queueName = getQueueNameForPlant(inputMessage);
  await getServiceBusSender(queueName).sendMessages({
    body: compassMessage,
    contentType: "application/xml",
    correlationId: context.traceContext.attributes.correlationId,
    sessionId: `${inputMessage.Batch.Batch}`,
  });
  context.info("Sent message to Compass");
}

async function isValidPlant(
  inputMessage: SAPMessage,
  context: InvocationContext,
  containerClient: MyContainerClient,
) {
  if (!plantConversions.hasCompassValue(inputMessage.EWMWarehouse)) {
    context.info(
      `Skipping this message, '${inputMessage.EWMWarehouse}' is not a Compass plant`,
    );
    return false;
  }

  // Unless enabled, skip messages bound for Compass1
  // TODO Remove this post go-live of Compass1
  else if (
    isCompass1Plant(inputMessage.EWMWarehouse) &&
    process.env.ENABLE_SAP_TO_COMPASS1 !== "true"
  ) {
    context.info(
      `Skipping this message, sending messages to Compass1 is not enabled`,
    );
    return false;
  }

  // If it is not for 1017, then no further checks are needed and it is a valid plant
  if (inputMessage.EWMWarehouse !== "1017") {
    return true;
  }

  // Plant 1017 is special: It is mapped to multiple plants (Compass and non-Compass).
  // Use the MES_SYSTEM class characteristic to determine if it is for Compass.
  const hasCompassCharacteristic = await has1017CompassClassCharacteristic(
    inputMessage.Product.Product,
    context,
    containerClient,
  );
  if (!hasCompassCharacteristic) {
    context.info(
      `Skipping plant '${inputMessage.EWMWarehouse}' because MES_SYSTEM class characteristic indicates that it is not for Compass`,
    );
    return false;
  }

  return true;
}

/**
 * We have two Compass instances, each listening to their own queue. This
 * function determines which queue to send the message to.
 *
 * @returns The name of the Service Bus queue for the given plant
 */
function getQueueNameForPlant(inputMessage: SAPMessage) {
  // Special case for APN: Use queue for Compass2
  if (!isCompass1Plant(inputMessage.EWMWarehouse)) {
    return "inventory-location-move-to-compass";
  }

  // All other plants use Compass1
  return "inventory-location-move-to-compass1";
}

/**
 * @returns XML file used to update an existing record to Azure Blob Storage
 */
function createXml(message: SAPMessage): string {
  const plant = plantConversions.getCompassValue(message.EWMWarehouse);
  const uom = uomConversions.getCompassValue(
    message.EWMStockQtyBaseUnitISOCode,
  );
  const status = convertStatus(message);

  return `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ipdERPLotMasterUpdate">
  <UnitStart>
    <BranchPlant>${plant}</BranchPlant>
    <Container>${message.Batch.Batch}</Container>
    <Product>${message.Product.Product}</Product>
    <Qty>${message.AvailableEWMStockQty}</Qty>
    <UOM>${uom}</UOM>
    <Location>${message.EWMStorageBin}</Location>
    <Status>${status}</Status>
    <MemoLot1 />
    <MemoLot2 />
    <MemoLot3 />
    <SupplierLot>${message.Batch.BatchBySupplier}</SupplierLot>
    <Shipped />
    <ExpirationDate>${message.ShelfLifeExpirationDate || ""}</ExpirationDate>
    <SellByDate />
    <Source />
  </UnitStart>
</Root>
`;
}

function convertStatus(message: SAPMessage) {
  if (message.AvailableEWMStockQty == 0) return "";
  const isBatchRestrictedUseStock = message.EWMBatchIsInRestrictedUseStock;
  const status = inventoryLocationMoveStatusConversions.getCompassValue(
    message.EWMStockType,
  );
  if (status == "" && isBatchRestrictedUseStock == true) {
    // f2 and restricted => X
    return "X";
  }
  return status;
}
