import { app, InvocationContext } from "@azure/functions";
import { MyContainerClient } from "../../message-archive-client";
import { plantConversions } from "../../conversions/conversion-table";
import { CompassMessage, SuperBackFlushXml } from "./route-compass-output.d";
import { ProductionOrderConfirmationRequest } from "../sap-api.d";
import { sendProductionOrderConfirmation } from "../sap-api";
import { populateTraceContext } from "../trace-context";
import {
  getXmlFileGuid,
  setTransactionManagerCompletedStatus,
  setTransactionManagerFailedStatus,
} from "./mes-transaction-manager";
import { getCompassXmlParser } from "./compass-xml-parser";

const functionName = "production-order-confirmation-to-sap";
const topic = "superbackflush-from-compass-v1";

/**
 * Registers this function to listen to the Production Order Confirmation queue
 */
app.serviceBusTopic(functionName, {
  connection: "CompassServiceBusConnection",
  // The topicName and subscriptionName are defined in bicep/service-bus.bicep
  topicName: topic,
  subscriptionName: `${functionName}-function`,
  handler: handler,
  cardinality: "one",
  isSessionsEnabled: true,
});

export async function handler(
  message: unknown,
  context: InvocationContext,
): Promise<void> {
  populateTraceContext(context);
  context.info(
    "Received Production Order Confirmation message from Compass to SAP",
  );

  // Parse the incoming XML message
  const parser = getCompassXmlParser();
  const xml = parser.parse(
    message as string,
  ) as CompassMessage<SuperBackFlushXml>;

  // Any errors before this point result in a Function invocation failure.
  // Errors before this point are not handled by users, but by the support team.
  const fileGuid = getXmlFileGuid(xml, context);

  try {
    // Add the metadata to the logs for easier troubleshooting
    context.traceContext.attributes.batch = `${xml?.TxnList?.TxnWrapper[0]?.Txn?.Request?.MessageDetail?.szLot_LOTN}`;
    context.traceContext.attributes.plant = `${xml?.TxnList?.TxnWrapper[0]?.Txn?.Request?.MessageDetail?.InterfaceControlBranchPlant}`;
    context.traceContext.attributes.productionOrder = `${xml?.TxnList?.TxnWrapper[0]?.Txn?.Request?.MessageDetail?.mnOrderNumber_DOCO}`;
    context.info("Trace context attributes", context.traceContext.attributes);

    // This flag is used to determine whether the Compass transaction manager should be updated at the end
    let hasNonGoodsReceiptMessages = false;

    // Send the Production Order Confirmation API requests
    context.info(
      "Processing Production Order Confirmation requests to SAP API",
    );
    const txnList = xml.TxnList.TxnWrapper.map(
      (txnWrapper) => txnWrapper.Txn.Request,
    );
    const containerClient = new MyContainerClient(context, functionName);
    for (const txn of txnList) {
      // Filter out Goods Receipt: they are processed by goods-receipt-to-sap.ts
      if (!isNotGoodsReceipt(txn, context) == true) {
        continue;
      }
      hasNonGoodsReceiptMessages = true;

      // Filter out messages that are not for SAP plants
      if (
        !plantConversions.hasSAPValue(
          txn.MessageDetail.InterfaceControlBranchPlant,
        )
      ) {
        context.info(
          `Skipping order ${txn.MessageDetail.mnOrderNumber_DOCO}, operation ${txn.MessageDetail.mnSequenceNumber_SEQU}, because ${txn.MessageDetail.InterfaceControlBranchPlant} is not an SAP plant`,
        );
        continue;
      }

      const body = await getRequestBody(txn);
      await sendProductionOrderConfirmation(
        body,
        containerClient,
        context,
        true,
      );

      // Log the successful processing of all messages
      context.info(
        `Successfully confirmed Production Order ${txn.MessageDetail.mnOrderNumber_DOCO}, operation ${txn.MessageDetail.mnSequenceNumber_SEQU}`,
      );
    }

    // Log the successful processing of all messages
    const message = "Finished processing Production Order Confirmations";
    context.info(message);
    if (hasNonGoodsReceiptMessages) {
      await setTransactionManagerCompletedStatus(fileGuid, message, context);
    }
  } catch (error) {
    const message = `Failed to process Production Order Confirmation: ${error}`;
    context.error(message);
    await setTransactionManagerFailedStatus(fileGuid, message, context);
  }
}

/**
 * Used to determine if this transaction should be processed by this
 * Function or by goods-receipt-to-sap.ts.
 *
 * @returns true if the transaction is not a Goods Receipt
 */
function isNotGoodsReceipt(
  txn: SuperBackFlushXml,
  context: InvocationContext,
): boolean {
  if (!txn.MessageDetail.szSAPReceiptFlag) {
    return true;
  }

  context.info(
    "Skipping",
    txn.MessageDetail.mnOrderNumber_DOCO,
    "operation",
    txn.MessageDetail.mnSequenceNumber_SEQU,
    "because it is a Goods Receipt, not just a Production Order Confirmation",
  );
  return false;
}

/**
 * @returns the request body for the Production Order Confirmation API
 */
async function getRequestBody(
  xml: SuperBackFlushXml,
): Promise<ProductionOrderConfirmationRequest> {
  const body = {
    OrderID: `${xml.MessageDetail.mnOrderNumber_DOCO}`,
    Plant: plantConversions.getSAPValue(
      xml.MessageDetail.InterfaceControlBranchPlant,
    ),
    OrderOperation: `${xml.MessageDetail.mnSequenceNumber_SEQU}`.padStart(
      4,
      "0",
    ),
    Sequence: "00",
    ConfirmationYieldQuantity: `${xml.MessageDetail.mnInputQtyCompleted_QT01}`,
    ConfirmationScrapQuantity: `${xml.MessageDetail.mnInputQtyCanceled_TRQT}`,
  } as ProductionOrderConfirmationRequest;

  // Indicate that the route step (operation) has been completed
  if (xml.MessageDetail.szInputOpStatusCode_OPST == 30) {
    body.OpenReservationsIsCleared = true;
    body.IsFinalConfirmation = true;
    body.FinalConfirmationType = "X";
  }

  return body;
}
