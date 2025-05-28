// See https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger?tabs=python-v2%2Cisolated-process%2Cnodejs-v4%2Cextensionv5&pivots=programming-language-typescript

import { app, InvocationContext } from "@azure/functions";
import { getServiceBusSender } from "../../service-bus-client";
import {
  CompassMessage,
  CompassXml,
  ComponentsGoodsIssuesXml,
  SuperBackFlushXml,
} from "./route-compass-output.d";
import { populateTraceContext } from "../trace-context";
import {
  getXmlFileGuid,
  setTransactionManagerInProcessStatus,
  setTransactionManagerFailedStatus,
} from "./mes-transaction-manager";
import { MyContainerClient } from "../../message-archive-client";
import { getCompassXmlParser } from "./compass-xml-parser";

const functionName = "route-compass-output";

/**
 * Registers this function to listen to the SAP Service Bus queue
 */
app.serviceBusTopic(functionName, {
  connection: "CompassServiceBusConnection",
  // The topicName and subscriptionName are defined in bicep/service-bus-compass-output-xml.bicep
  topicName: "compass-output-xml",
  subscriptionName: `${functionName}-function`,
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
  populateTraceContext(context);
  context.info("Received XML from Compass");

  // Archive the incoming message
  const containerClient = new MyContainerClient(context, functionName);
  const blobName = await containerClient.upload(message, "input.xml");
  context.info(
    `Archived Compass XML at ${containerClient.getBrowserLink(blobName)}`,
  );

  // Parse the incoming XML message
  const parser = getCompassXmlParser();
  const xml = parser.parse(message as string) as CompassMessage<CompassXml>;

  // Abort if no nodes are present that we could process
  if (!xml?.TxnList?.TxnWrapper || xml.TxnList.TxnWrapper.length === 0) {
    context.warn("No TxnWrapper nodes found in the Compass XML document");
    return;
  }

  // Set the in-process flag. Completion is handled in downstream functions.
  // Any errors before this point result in a Function invocation failure.
  // Errors before this point are not handled by users, but by the support team.
  const fileGuid = getXmlFileGuid(xml, context);
  await setTransactionManagerInProcessStatus(fileGuid, context);

  try {
    /*
     * Determine the message type. If multiple messages are present, use the
     * first one. This works because Compass only combines multiple messages into
     * a single XML document if they belong together, i.e. the MessageHeader is
     * the same.
     */
    const messageType = `${xml.TxnList.TxnWrapper[0].Txn?.Request?.MessageHeader?.MessageType}`;
    context.traceContext.attributes.mesMessageType = messageType;
    context.info("Trace context attributes", context.traceContext.attributes);

    let topic: string;
    let sessionId: string | undefined = undefined;

    // Forward SuperBackflush messages
    if (messageType === "SuperBackFlush") {
      context.info("Forwarding SuperBackflush message");
      topic = "superbackflush-from-compass";

      // Extract the session ID from the message
      const txn = xml.TxnList.TxnWrapper[0].Txn.Request as SuperBackFlushXml;
      sessionId = `${txn.MessageDetail.mnOrderNumber_DOCO}`;
    }

    // Forward WorkOrderIssues messages
    else if (messageType === "WorkOrderIssues") {
      context.info("Forwarding WorkOrderIssues message");
      topic = "workorderissues-from-compass";

      // Extract the session ID from the message
      const txn = xml.TxnList.TxnWrapper[0].Txn
        .Request as ComponentsGoodsIssuesXml;
      sessionId = `${txn.MessageDetail.mnDocumentOrderInvoiceE_DOCO}`;
    }

    // Error out if we received an unknown message type
    else {
      const message = `Unable to identify the message type "${messageType}"`;
      context.warn(message);
      setTransactionManagerFailedStatus(fileGuid, message, context);
      return;
    }

    // Send the message as-is to the corresponding "v1" topic
    await getServiceBusSender(`${topic}-v1`).sendMessages({
      body: message,
      contentType: "application/xml",
      correlationId: context.traceContext.attributes.correlationId,
      sessionId: sessionId,
    });

    // Send the JSON-version of the message to the corresponding "v2" topic
    await getServiceBusSender(`${topic}-v2`).sendMessages({
      body: JSON.stringify(xml),
      contentType: "application/json",
      correlationId: context.traceContext.attributes.correlationId,
    });
  } catch (error) {
    const message = `Failed to route Compass XML: ${error}`;
    context.error(message);
    setTransactionManagerFailedStatus(fileGuid, message, context);
  }
}
