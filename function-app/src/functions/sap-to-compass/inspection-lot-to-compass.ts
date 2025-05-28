// See https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger?tabs=python-v2%2Cisolated-process%2Cnodejs-v4%2Cextensionv5&pivots=programming-language-typescript

import { app, InvocationContext } from "@azure/functions";
import { getServiceBusSender } from "../../service-bus-client";
import { SAPMessage } from "./inspection-lot-to-compass.d";
import {
  isCompass1Plant,
  plantConversions,
  uomConversions,
} from "../../conversions/conversion-table";
import { sanitizeFilename } from "../sanitize-filename";
import { populateTraceContext } from "../trace-context";
import { MyContainerClient } from "../../message-archive-client";
import { has1017CompassClassCharacteristic } from "../has-1017-compass-class-assignment";

const functionName = "inspection-lot-to-compass";
// This topic name must match the name in https://github.com/goreperformancesolution/sap-integration-azure-infrastructure
const topic = "inspection-lot-v1-topic";

/**
 * Registers this function to listen to the SAP Service Bus Inspection Lot topic
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
  // Add metadata to the logs for easier troubleshooting
  populateTraceContext(context);
  const inputMessage = message as SAPMessage;
  context.traceContext.attributes.batch = `${inputMessage.Batch?.Batch}`;
  context.traceContext.attributes.materialNumber = `${inputMessage.Material}`;
  context.traceContext.attributes.mesMessageType = "ipdERPLotMasterUpdate";
  context.traceContext.attributes.plant = `${inputMessage.Plant}`;
  context.info("Trace context attributes", context.traceContext.attributes);

  // Archive the incoming message
  const containerClient = new MyContainerClient(context, functionName);
  const inputBlobName = await containerClient.upload(message, "input.json");
  const inputBlobLink = containerClient.getBrowserLink(inputBlobName);
  context.info(
    `Archived incoming SAP Inspection Lot message at ${inputBlobLink}`,
  );

  const isValidPlantResult = await isValidPlant(
    inputMessage,
    context,
    containerClient,
  );
  if (!isValidPlantResult) {
    return;
  }

  // Convert SAP message to Compass XML format
  context.info("Creating Compass XML message");
  const xml = createXml(inputMessage);

  // Archive the Compass XML file
  const blobName = await containerClient.upload(xml, "output.xml");
  const link = containerClient.getBrowserLink(blobName);
  context.info(`Archived Compass Inspection Lot XML at ${link}`);

  // Send the message to Compass
  context.info("Sending message to Compass");
  const compassMessage = {
    Plant: plantConversions.getCompassValue(inputMessage.Plant),
    Batch: inputMessage.Batch.Batch,
    Filename: sanitizeFilename(
      `IL-${inputMessage.Batch.Batch}-${plantConversions.getCompassValue(inputMessage.Plant)}-${context.triggerMetadata?.messageId}.xml`,
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
  // Skip messages for non-Compass plants
  if (!plantConversions.hasCompassValue(inputMessage.Plant)) {
    context.info(
      `Skipping this message, '${inputMessage.Plant}' is not a Compass plant`,
    );
    return false;
  }

  // Unless enabled, skip messages bound for Compass1
  // TODO Remove this post go-live of Compass1
  else if (
    isCompass1Plant(inputMessage.Plant) &&
    process.env.ENABLE_SAP_TO_COMPASS1 !== "true"
  ) {
    context.info(
      `Skipping this message, sending messages to Compass1 is not enabled`,
    );
    return false;
  }

  // If it is not for 1017, then no further checks are needed and it is a valid plant
  if (inputMessage.Plant !== "1017") {
    return true;
  }

  // Plant 1017 is special: It is mapped to multiple plants (Compass and non-Compass).
  // Use the MES_SYSTEM class characteristic to determine if it is for Compass.
  const hasCompassCharacteristic = await has1017CompassClassCharacteristic(
    inputMessage.Material,
    context,
    containerClient,
  );
  if (!hasCompassCharacteristic) {
    context.info(
      `Skipping plant '${inputMessage.Plant}' because MES_SYSTEM class characteristic indicates that it is not for Compass`,
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
  if (!isCompass1Plant(inputMessage.Plant)) {
    return "inventory-location-move-to-compass";
  }

  // All other plants use Compass1
  return "inventory-location-move-to-compass1";
}

/**
 * @returns XML file used to update an existing record to Azure Blob Storage
 */
function createXml(message: SAPMessage): string {
  const plant = plantConversions.getCompassValue(message.Plant);
  const uom = uomConversions.getCompassValue(message.InspectionLotQuantityUnit);
  /*
   * The BatchBySupplier field is not always present in the message. If it is
   * not present, we use the BatchBySupplier field from the Batch object.
   *
   * This scenario happens when the supplier lot information is not available
   * when the inspection lot is created. In this case, users update the
   * supplier lot on the batch afterwards, which is why it is then only
   * available on the Batch object.
   */
  const supplierLot = message.BatchBySupplier
    ? message.BatchBySupplier
    : message.Batch.BatchBySupplier;

  return `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ipdERPLotMasterUpdate">
  <UnitStart>
    <BranchPlant>${plant}</BranchPlant>
    <Container>${message.Batch.Batch}</Container>
    <Product>${message.Material}</Product>
    <Qty>${message.InspectionLotQuantity}</Qty>
    <UOM>${uom}</UOM>
    <Location>${message.BatchStorageLocation}</Location>
    <Status></Status>
    <MemoLot1 />
    <MemoLot2 />
    <MemoLot3 />
    <SupplierLot>${supplierLot}</SupplierLot>
  </UnitStart>
</Root>
`;
}
