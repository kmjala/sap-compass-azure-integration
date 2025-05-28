import { app, InvocationContext } from "@azure/functions";
import { MyContainerClient } from "../../message-archive-client";
import { SuperBackFlushXml, CompassMessage } from "./route-compass-output.d";
import { plantConversions } from "../../conversions/conversion-table";
import { ProductionOrderConfirmationRequest } from "../sap-api.d";
import {
  getProductionOrder,
  sendProductionOrderConfirmation,
} from "../sap-api";
import { populateTraceContext } from "../trace-context";
import {
  getXmlFileGuid,
  setTransactionManagerCompletedStatus,
  setTransactionManagerFailedStatus,
} from "./mes-transaction-manager";
import { getCompassXmlParser } from "./compass-xml-parser";

const functionName = "goods-receipt-to-sap";
const topic = "superbackflush-from-compass-v1";

/**
 * Registers this function to listen to the SuperBackFlush queue
 */
app.serviceBusTopic(functionName, {
  connection: "CompassServiceBusConnection",
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
  context.info("Received Goods Receipt message from Compass to SAP");

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
    context.traceContext.attributes.user = `${xml?.TxnList?.TxnWrapper[0]?.UserName}`;
    context.info("Trace context attributes", context.traceContext.attributes);

    // This flag is used to determine whether the Compass transaction manager should be updated at the end
    let hasGoodsReceipt = false;

    context.info("Processing Goods Receipt requests to SAP API");
    const txnList = xml.TxnList.TxnWrapper.map(
      (txnWrapper) => txnWrapper.Txn.Request,
    );
    for (const txn of txnList) {
      // Filter out Production Order Confirmations: they are processed by production-order-confirmation-to-sap.ts
      if (!isGoodsReceipt(txn, context)) {
        continue;
      }
      hasGoodsReceipt = true;

      // Filter out messages that are not for SAP plants
      if (
        !plantConversions.hasSAPValue(
          txn.MessageDetail.InterfaceControlBranchPlant,
        )
      ) {
        context.info(
          `Skipping order ${txn.MessageDetail.mnOrderNumber_DOCO}, operation ${txn.MessageDetail.mnSequenceNumber_SEQU} because ${txn.MessageDetail.InterfaceControlBranchPlant} is not an SAP plant`,
        );
        continue;
      }

      const containerClient = new MyContainerClient(context, functionName);
      const body = await getRequestBody(txn, context, containerClient);
      await sendProductionOrderConfirmation(
        body,
        containerClient,
        context,
        true,
      );
      context.info("Successfully sent Goods Receipt message to SAP");
    }

    // Log the successful processing of all messages
    const message = "Successfully processed all Goods Receipt messages";
    context.info(message);
    if (hasGoodsReceipt) {
      await setTransactionManagerCompletedStatus(fileGuid, message, context);
    }
  } catch (error) {
    const message = `Failed to process Goods Receipt: ${error}`;
    context.error(message);
    await setTransactionManagerFailedStatus(fileGuid, message, context);
  }
}

/**
 * Used to determine if this transaction should be processed by this
 * Function or by production-confirmation-to-sap.ts.
 *
 * @returns true if the transaction is not a Goods Receipt
 */
function isGoodsReceipt(
  txn: SuperBackFlushXml,
  context: InvocationContext,
): boolean {
  if (txn.MessageDetail.szSAPReceiptFlag) {
    return true;
  }

  context.info(
    "Skipping",
    txn.MessageDetail.mnOrderNumber_DOCO,
    "operation",
    txn.MessageDetail.mnSequenceNumber_SEQU,
    "because it is only a Production Order Confirmation, not a Goods Receipt",
  );
  return false;
}

/**
 * @returns the request body for the Production Order Confirmation API
 */
async function getRequestBody(
  xml: SuperBackFlushXml,
  context: InvocationContext,
  containerClient: MyContainerClient,
): Promise<ProductionOrderConfirmationRequest> {
  let quantity = xml.MessageDetail.mnInputQtyCompleted_QT01;
  let confirmationYieldQuantity = xml.MessageDetail.mnInputQtyCompleted_QT01;
  let confirmationScrapQuantity = xml.MessageDetail.mnInputQtyCanceled_TRQT;
  let goodsMovementType = "101";
  if (quantity < 0) {
    quantity *= -1;
    goodsMovementType = "102";
    confirmationYieldQuantity = 0;
    confirmationScrapQuantity = 0;
  }
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
    ConfirmationYieldQuantity: `${confirmationYieldQuantity}`,
    ConfirmationScrapQuantity: `${confirmationScrapQuantity}`,
  } as ProductionOrderConfirmationRequest;

  // Add the metadata to the logs for easier troubleshooting
  context.traceContext.attributes.productionOrder = body.OrderID;
  context.info("Trace context attributes", context.traceContext.attributes);

  // Indicate that the route step (operation) has been completed
  if (xml.MessageDetail.szInputOpStatusCode_OPST == 30) {
    body.IsFinalConfirmation = true;
    body.FinalConfirmationType = "X";
  }

  // Include material movements if inventory was moved
  const productionOrder = await getProductionOrder(
    xml.MessageDetail.mnOrderNumber_DOCO,
    containerClient,
    context,
  );
  body.to_ProdnOrdConfMatlDocItm = [
    {
      OrderID: `${xml.MessageDetail.mnOrderNumber_DOCO}`,
      OrderItem: "0001",
      Material: productionOrder.d.Material,
      Plant: plantConversions.getSAPValue(
        xml.MessageDetail.InterfaceControlBranchPlant,
      ),
      StorageLocation: "2000",
      GoodsMovementType: goodsMovementType,
      GoodsMovementRefDocType: "F",
      EntryUnit: productionOrder.d.ProductionUnit,
      QuantityInEntryUnit: `${quantity}`,
      Batch: `${xml.MessageDetail.szLot_LOTN}`,
      EWMStorageBin: `${xml.MessageDetail.szLocation_LOCN}`,
      EWMWarehouse: plantConversions.getSAPValue(
        xml.MessageDetail.InterfaceControlBranchPlant,
      ),
      ManufactureDate: `/Date(${Date.now()})/`,
      to_ProdnOrderConfBatchCharc: [
        {
          Characteristic: "ZLOBM_PARENTBATCH",
          CharcValue: `${xml.MessageDetail.szMemoLotField1}`,
        },
      ],
    },
  ];

  return body;
}
