// See https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger?tabs=python-v2%2Cisolated-process%2Cnodejs-v4%2Cextensionv5&pivots=programming-language-typescript

import { app, InvocationContext } from "@azure/functions";
import { MyContainerClient } from "../../message-archive-client";
import { getServiceBusSender } from "../../service-bus-client";
import {
  ProductionOrderComponent,
  ProductionOrderOperation,
  SAPMessage,
} from "./production-order-to-compass.d";
import { sanitizeFilename } from "../sanitize-filename";
import {
  isCompass1Plant,
  plantConversions,
  uomConversions,
} from "../../conversions/conversion-table";
import { populateTraceContext } from "../trace-context";
import { has1017CompassClassCharacteristic } from "../has-1017-compass-class-assignment";

const functionName = "production-order-to-compass";
// This topic name must match the name in https://github.com/goreperformancesolution/sap-integration-azure-infrastructure
const topic = "production-order-v1-topic";
const statusCreated = "-1";

/**
 * Registers this function to listen to the SAP Event Hub Production Order topic
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
 * For now, writes the message form the SAP Event Hub topic as-is to the Compass Service Bus queue.
 */
export async function handler(
  message: unknown,
  context: InvocationContext,
): Promise<void> {
  // Add the metadata to the logs for easier troubleshooting
  populateTraceContext(context);
  const inputMessage = message as SAPMessage;
  context.traceContext.attributes.materialNumber = `${inputMessage.Material}`;
  context.traceContext.attributes.mesMessageType =
    "ERPWOStart ERPWOChange ERPRouteStart ERPRouteChange ERPMatlListChange";
  context.traceContext.attributes.plant = `${inputMessage.ProductionPlant}`;
  context.traceContext.attributes.productionOrder = `${inputMessage.ManufacturingOrder}`;
  context.info("Trace context attributes", context.traceContext.attributes);

  // Archive the incoming message
  const containerClient = new MyContainerClient(context, functionName);
  const inputBlobName = await containerClient.upload(message, "input.json");
  const inputBlobLink = containerClient.getBrowserLink(inputBlobName);
  context.info(
    `Archived incoming SAP Production Order message at ${inputBlobLink}`,
  );

  const isValidPlantResult = await isValidPlant(
    inputMessage,
    context,
    containerClient,
  );
  if (!isValidPlantResult) {
    return;
  }

  const status = translateStatus(inputMessage);
  if (status === statusCreated) {
    context.info(
      `Skipping this message, Production Order '${inputMessage.ManufacturingOrder}' has status 'Created'`,
    );
    return;
  }

  // Archive the XML file sent to Compass
  context.info("Creating Compass XML message");
  const createProductionOrderBlobName = await getCreateProductionOrderXml(
    inputMessage,
    status,
    containerClient,
    context,
  );
  const updateProductionOrderBlobName = await getUpdateProductionOrderXml(
    inputMessage,
    containerClient,
    context,
  );
  const createProductionOrderOperationsBlobName =
    await getCreateProductionOrderOperationsXml(
      inputMessage,
      containerClient,
      context,
    );
  const updateProductionOrderOperationsBlobName =
    await getUpdateProductionOrderOperationsXml(
      inputMessage,
      containerClient,
      context,
    );
  const updateProductionOrderComponentsBlobName =
    await getUpdateProductionOrderComponentsXml(
      inputMessage,
      containerClient,
      context,
    );
  context.info("Archived XMLs");

  // Send the message to Compass
  context.info("Sending message to Compass");
  const compassPlant = plantConversions.getCompassValue(
    inputMessage.ProductionPlant,
  );
  const filePrefix = `${inputMessage.ManufacturingOrder}-${compassPlant}`;
  const fileSuffix = `${context.triggerMetadata.messageId}.xml`;
  const compassMessage = {
    Plant: compassPlant,
    ProductionOrder: inputMessage.ManufacturingOrder,
    ProductionOrderFilename: sanitizeFilename(`WO-${filePrefix}-${fileSuffix}`),
    CreateProductionOrder: createProductionOrderBlobName,
    UpdateProductionOrder: updateProductionOrderBlobName,
    ProductionOrderOperationsFilename: sanitizeFilename(
      `WOO-${filePrefix}-route-${fileSuffix}`,
    ),
    CreateProductionOrderOperations: createProductionOrderOperationsBlobName,
    UpdateProductionOrderOperations: updateProductionOrderOperationsBlobName,
    ProductionOrderComponentsFilename: sanitizeFilename(
      `WOC-${filePrefix}-components-${fileSuffix}`,
    ),
    UpdateProductionOrderComponents: updateProductionOrderComponentsBlobName,
  };
  await containerClient.upload(compassMessage, "compass-message.json");

  const queueName = getQueueNameForPlant(inputMessage);
  await getServiceBusSender(queueName).sendMessages({
    body: compassMessage,
    contentType: "application/json",
    correlationId: context.traceContext.attributes.correlationId,
    sessionId: `${inputMessage.ManufacturingOrder}`,
  });
  context.info("Sent message to Compass");
}

/**
 * We have two Compass instances, each listening to their own queue. This
 * function determines which queue to send the message to.
 *
 * @returns The name of the Service Bus queue for the given plant
 */
function getQueueNameForPlant(inputMessage: SAPMessage) {
  // Special case for APN: Use queue for Compass2
  if (!isCompass1Plant(inputMessage.ProductionPlant)) {
    return "production-order-to-compass";
  }

  // All other plants use Compass1
  return "production-order-to-compass1";
}

async function isValidPlant(
  inputMessage: SAPMessage,
  context: InvocationContext,
  containerClient: MyContainerClient,
) {
  // Skip messages for plants that are not Compass plants
  if (!plantConversions.hasCompassValue(inputMessage.ProductionPlant)) {
    context.info(
      `Skipping this message, '${inputMessage.ProductionPlant}' is not a Compass plant`,
    );
    return false;
  }

  // Unless enabled, skip messages bound for Compass1
  // TODO Remove this post go-live of Compass1
  if (
    isCompass1Plant(inputMessage.ProductionPlant) &&
    process.env.ENABLE_SAP_TO_COMPASS1 !== "true"
  ) {
    context.info(
      `Skipping this message, sending messages to Compass1 is not enabled`,
    );
    return false;
  }

  // If it is not for 1017, then no further checks are needed and it is a valid plant
  if (inputMessage.ProductionPlant !== "1017") {
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
      `Skipping plant '${inputMessage.ProductionPlant}' because MES_SYSTEM class characteristic indicates that it is not for Compass`,
    );
    return false;
  }

  return true;
}

async function getCreateProductionOrderXml(
  message: SAPMessage,
  status: string,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<string> {
  context.info("Creating ERPWOStart XML");

  const blobContent = `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ERPWOStart">
  <WOStart>
    <BranchPlant>${plantConversions.getCompassValue(message.ProductionPlant)}</BranchPlant>
    <WONumber>${message.ManufacturingOrder}</WONumber>
    <Product>${message.Material}</Product>
    <Qty>${message.TotalQuantity}</Qty>
    <UOM>${uomConversions.getCompassValue(message.ProductionUnitISOCode)}</UOM>
    <Status>${status}</Status>
    <StartDate>${isoDateToCompassDate(message.MfgOrderScheduledStartDateTimeISO)}</StartDate>
    <CompDate>${isoDateToCompassDate(message.MfgOrderScheduledEndDateTimeISO)}</CompDate>
    <ERPRoute>${message.ManufacturingOrder}</ERPRoute>
    <ItemList>
${getBomItemXml(message)}
    </ItemList>
    <ERPOrderType>ERPWO</ERPOrderType>
  </WOStart>
</Root>
`;
  const blobName = await containerClient.upload(
    blobContent,
    "create-production-order.xml",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived XML to create a new production order (ERPWOStart) at ${link}`,
  );
  return blobName;
}

/**
 * Converts the ProductionOrderComponents to XML format for the BOMItem elements.
 */
function getBomItemXml(message: SAPMessage): string {
  const combinedComponents = new Map<string, ProductionOrderComponent>();
  message.ProductionOrderComponents
    // Remove empty Material components
    .filter((component) => component.Material)
    // Remove components marked for deletion
    .filter((component) => !component.MatlCompIsMarkedForDeletion)
    // Remove phantom components
    .filter((component) => !component.MaterialComponentIsPhantomItem)
    // Remove bulk components
    .filter((component) => !component.IsBulkMaterialComponent)
    // Remove backflush components
    .filter((component) => !component.MatlCompIsMarkedForBackflush)
    // Combine the same components with fixed and variable quantities
    .forEach((component) => {
      const key = `${component.Material}-${component.ManufacturingOrderOperation}-${component.BaseUnitISOCode}`;
      // If the component exists, add the quantities together
      if (combinedComponents.has(key)) {
        combinedComponents.get(key).RequiredQuantity = (
          parseFloat(combinedComponents.get(key).RequiredQuantity) +
          parseFloat(component.RequiredQuantity)
        ).toFixed(3); // round to 3 decimal places
      }
      // If the component does not exists, add it to the list
      else {
        combinedComponents.set(key, { ...component });
      }
    });

  // Ignore non-consumable components, e.g. IUO labels or dies.
  const withoutNonConsumables = Array.from(combinedComponents.values()).filter(
    (component) => {
      const requiredQuantity = parseFloat(component.RequiredQuantity);
      return !(
        getIssueTypeCode(component) === "F" &&
        (requiredQuantity === 0 || Number.isNaN(requiredQuantity))
      );
    },
  );

  // Create a BOMItem for each ProductionOrderComponent
  const bomItemXmls = withoutNonConsumables
    .map((component) => {
      return `
<BOMItem>
  <Qty>${component.RequiredQuantity}</Qty>
  <Item>${component.Material}</Item>
  <SeqNum>${parseInt(component.ManufacturingOrderOperation)}00</SeqNum>
  <ItemUOM>${uomConversions.getCompassValue(component.BaseUnitISOCode)}</ItemUOM>
  <ItemLocation>${component.StorageLocation}</ItemLocation>
  <IssueTypeCode>${getIssueTypeCode(component)}</IssueTypeCode>
</BOMItem>
`.trim();
    })
    // Indent each line with 4 spaces to format it well in the final XML
    .map((component) =>
      component
        .trim()
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n"),
    );

  // Join all the BOMItems into a single XML string
  return bomItemXmls.join("\n");
}

/**
 * @returns the IssueTypeCode based on the IsBulkMaterialComponent and MatlCompIsMarkedForBackflush flags
 */
function getIssueTypeCode(component: ProductionOrderComponent): string {
  if (
    !component.IsBulkMaterialComponent &&
    !component.MatlCompIsMarkedForBackflush
  ) {
    return "I";
  } else if (
    component.IsBulkMaterialComponent &&
    !component.MatlCompIsMarkedForBackflush
  ) {
    return "F";
  } else if (
    !component.IsBulkMaterialComponent &&
    component.MatlCompIsMarkedForBackflush
  ) {
    return "B";
  } else {
    throw new Error(
      "Both IsBulkMaterialComponent and MatlCompIsMarkedForBackflush is true, which is a data error",
    );
  }
}

async function getUpdateProductionOrderXml(
  message: SAPMessage,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<string> {
  context.info("Creating ERPWOChange XML");

  const blobContent = `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ERPWOChange">
  <WOStart>
    <BranchPlant>${plantConversions.getCompassValue(message.ProductionPlant)}</BranchPlant>
    <WONumber>${message.ManufacturingOrder}</WONumber>
    <Product>${message.Material}</Product>
    <Qty>${message.TotalQuantity}</Qty>
    <UOM>${uomConversions.getCompassValue(message.ProductionUnitISOCode)}</UOM>
    <Status>${translateStatus(message)}</Status>
    <StartDate>${isoDateToCompassDate(message.MfgOrderScheduledStartDateTimeISO)}</StartDate>
    <CompDate>${isoDateToCompassDate(message.MfgOrderScheduledEndDateTimeISO)}</CompDate>
    <ERPRoute>${message.ManufacturingOrder}</ERPRoute>
    <ERPOrderType>ERPWO</ERPOrderType>
  </WOStart>
</Root>
`;
  const blobName = await containerClient.upload(
    blobContent,
    "update-production-order.xml",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived XML to update an existing production order (ERPWOChange) at ${link}`,
  );
  return blobName;
}

async function getCreateProductionOrderOperationsXml(
  message: SAPMessage,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<string> {
  context.info("Creating ERPRouteStart XML");

  const blobContent = `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ERPRouteStart">
  <Name>${message.ManufacturingOrder}</Name>
  <Revision>1</Revision>
  <Description />
  <Notes />
  <Status>1</Status>
  <EOC />
  <Product>${message.Material}</Product>
  <ERPItem />
${getRouteStepAddXml(message, true)}
</Root>
`;
  const blobName = await containerClient.upload(
    blobContent,
    "create-production-order-operations.xml",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(`Archived XML to create a new route (ERPRouteStart) at ${link}`);
  return blobName;
}

/**
 * Converts the ProductionOrderComponents to XML format for the BOMItem elements.
 */
function getRouteStepAddXml(
  message: SAPMessage,
  isCreateProductionOrderOperations: boolean,
): string {
  return (
    message.ProductionOrderOperations.filter(
      (operation) => operation.OperationIsDeleted !== "X",
    )
      // Remove alternative operations, MES only cares about the standard operation
      .filter((operation) => `${operation.ManufacturingOrderSequence}` === "0")
      // Create a route step for each ProductionOrderOperations
      .map((operation) => {
        let xml = `
<StepName>${operation.WorkCenter}</StepName>
<Operation />
<Sequence>${parseInt(operation.ManufacturingOrderOperation)}</Sequence>
<StepDescription>${operation.MfgOrderOperationText}</StepDescription>
<WCStartDate>${isoDateToCompassDate(operation.OpErlstSchedldExecStrtDteTmeISO)}</WCStartDate>
<WCEndDate>${isoDateToCompassDate(operation.OpErlstSchedldExecEndDteTmeISO)}</WCEndDate>
<OperationStatus>${translateOperationStatus(operation)}</OperationStatus>
<PlannedQuantity>${operation.OpPlannedTotalQuantity}</PlannedQuantity>
`;
        // Append CompletedQuantity only for the Production Order Operations "Update XML" file
        if (!isCreateProductionOrderOperations) {
          xml += `<CompletedQuantity>${operation.OpTotalConfirmedYieldQty}</CompletedQuantity>`;
        }

        // Wrap the XML in RouteStepAdd tags
        xml = `
<RouteStepAdd>
${indentLines(xml, 2)}
</RouteStepAdd>
`;
        return xml;
      })
      // Indent each line with 4 spaces to format it well in the final XML
      .map((routeStep) => indentLines(routeStep, 2))
      // Join all the BOMItems into a single string
      .join("\n")
  );
}

/**
 * @returns the original text with each line indented by the given number of spaces
 */
function indentLines(text: string, indent: number): string {
  return text
    .trim()
    .split("\n")
    .map((line) => " ".repeat(indent) + line)
    .join("\n");
}

async function getUpdateProductionOrderOperationsXml(
  message: SAPMessage,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<string> {
  context.info("Creating ERPRouteChange XML");

  const blobContent = `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ERPRouteChange">
  <Name>${message.ManufacturingOrder}</Name>
  <Revision>1</Revision>
  <Description />
  <Notes />
  <Status>1</Status>
  <EOC />
  <Product>${message.Material}</Product>
  <ERPItem />
  <RouteStepDelete>
    <StepIndex />
  </RouteStepDelete>
${getRouteStepAddXml(message, false)}
</Root>
`;
  const blobName = await containerClient.upload(
    blobContent,
    "update-production-order-operations.xml",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived XML to update an existing route (ERPRouteChange) at ${link}`,
  );
  return blobName;
}

/**
 * @param datetime in the ISO format "yyyy-MM-ddTHH:mm:ss.sssZ"
 * @returns date in the Compass format "yyyy-MM-dd"
 */
function isoDateToCompassDate(datetime: string): string {
  // Convert if the date comes in as "2021-05-21T00:00:00"
  const match = datetime.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (match) {
    return match[1];
  }

  // Throw an error if the date format is unknown
  else {
    throw new Error(`Unknown date format: ${datetime}`);
  }
}

/**
 * @returns Compass Work Order status for the given Production Order
 */
function translateStatus(message: SAPMessage): string {
  if (
    message.OrderIsReleased === "X" &&
    message.OrderIsPartiallyConfirmed === "X" &&
    message.OrderIsDelivered === ""
  ) {
    return "45";
  } else if (
    message.OrderIsReleased === "X" &&
    message.OrderIsPartiallyDelivered === "X"
  ) {
    return "90";
  } else if (
    message.OrderIsReleased === "X" &&
    message.OrderIsConfirmed === "X"
  ) {
    return "95";
  } else if (message.OrderIsTechnicallyCompleted === "X") {
    return "95";
  } else if (message.OrderIsReleased === "X") {
    return "40";
  } else if (message.OrderIsCreated === "X") {
    return statusCreated;
  } else {
    throw new Error(
      `Failed to map status to Compass Work Order status. OrderIsReleased: '${message.OrderIsReleased}', OrderIsPartiallyConfirmed: '${message.OrderIsPartiallyConfirmed}', OrderIsDelivered: '${message.OrderIsDelivered}', OrderIsPartiallyDelivered: '${message.OrderIsPartiallyDelivered}', OrderIsConfirmed: '${message.OrderIsConfirmed}', OrderIsTechnicallyCompleted: '${message.OrderIsTechnicallyCompleted}', OrderIsCreated: '${message.OrderIsCreated}'.`,
    );
  }
}

/**
 * @returns Compass RouteStep OperationStatus for the given Production Order
 */
function translateOperationStatus(message: ProductionOrderOperation): string {
  if (message.OperationIsClosed === "X") {
    return "30";
  } else if (message.OperationIsPartiallyConfirmed === "X") {
    return "20";
  } else if (message.OperationIsReleased === "X") {
    return "10";
  } else {
    throw new Error(
      `Failed to map status to Compass Operations status. OperationIsClosed: '${message.OperationIsClosed}', OperationIsReleased: '${message.OperationIsReleased}', OperationIsPartiallyConfirmed: '${message.OperationIsPartiallyConfirmed}'.`,
    );
  }
}

async function getUpdateProductionOrderComponentsXml(
  message: SAPMessage,
  containerClient: MyContainerClient,
  context: InvocationContext,
): Promise<string> {
  context.info("Creating ERPMatlListChange XML");

  const blobContent = `<?xml version="1.0" encoding="utf-8"?>
<Root TransactionType="ERPMatlListChange">
  <WOrder>
    <WONumber>${message.ManufacturingOrder}</WONumber>
    <ItemDelete />
    <ItemList>
${getBomItemXml(message)}
    </ItemList>
  </WOrder>
</Root>
`;
  const blobName = await containerClient.upload(
    blobContent,
    "update-production-order-components.xml",
  );
  const link = containerClient.getBrowserLink(blobName);
  context.info(
    `Archived XML to update the material list (ERPMatlListChange) at ${link}`,
  );

  context.info("Archived ERPMatlListChange XML");
  return blobName;
}
