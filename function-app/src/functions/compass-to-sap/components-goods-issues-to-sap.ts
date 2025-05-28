import { app, InvocationContext } from "@azure/functions";
import {
  plantConversions,
  uomConversions,
} from "../../conversions/conversion-table";

import {
  CompassMessage,
  ComponentsGoodsIssuesXml,
} from "./route-compass-output.d";
import {
  sendProductionOrderConfirmation,
  getProductionOrderComponents,
} from "../sap-api";
import { ComponentGoodsIssuesRequest, Components } from "../sap-api.d";
import { populateTraceContext } from "../trace-context";
import {
  getXmlFileGuid,
  setTransactionManagerCompletedStatus,
  setTransactionManagerFailedStatus,
} from "./mes-transaction-manager";
import { MyContainerClient } from "../../message-archive-client";
import { getCompassXmlParser } from "./compass-xml-parser";

const functionName = "components-goods-issues-to-sap";

/**
 * Registers this function to listen to the Components Goods Issues queue
 */
app.serviceBusTopic(functionName, {
  connection: "CompassServiceBusConnection",
  topicName: "workorderissues-from-compass-v1",
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
  context.info("Received Components Goods Issue message from Compass to SAP");

  // Parse the incoming XML message
  const parser = getCompassXmlParser();
  const xml = parser.parse(
    message as string,
  ) as CompassMessage<ComponentsGoodsIssuesXml>;

  // Any errors before this point result in a Function invocation failure.
  // Errors before this point are not handled by users, but by the support team.
  const fileGuid = getXmlFileGuid(xml, context);

  try {
    // Add the metadata to the logs for easier troubleshooting
    context.traceContext.attributes.materialNumber = `${xml?.TxnList?.TxnWrapper[0]?.Txn?.Request?.MessageDetail?.szItemNoUnknownFormat_UITM}`;
    context.traceContext.attributes.plant = `${xml?.TxnList?.TxnWrapper[0]?.Txn?.Request?.MessageDetail?.szBranchPlant_MCU}`;
    context.traceContext.attributes.productionOrder = `${xml?.TxnList?.TxnWrapper[0]?.Txn?.Request?.MessageDetail?.mnDocumentOrderInvoiceE_DOCO}`;
    context.traceContext.attributes.user = `${xml?.TxnList?.TxnWrapper[0]?.UserName}`;
    context.info("Trace context attributes", context.traceContext.attributes);

    const txnList: ComponentsGoodsIssuesXml[] = xml.TxnList.TxnWrapper.map(
      (txnWrapper) => txnWrapper.Txn.Request,
    );

    // Sanity Checks
    // Skip messages for invalid Compass plants
    for (const txn of txnList) {
      if (!plantConversions.hasSAPValue(txn.MessageDetail.szBranchPlant_MCU)) {
        const message = `Skipped this message, '${txn.MessageDetail.szBranchPlant_MCU}' is not for an SAP plant`;
        context.info(message);
        await setTransactionManagerCompletedStatus(fileGuid, message, context);
        return;
      }
    }

    // Ensure OrderID, and OrderOperation are the same in each Txn
    const fieldsToCheck: (keyof ComponentsGoodsIssuesXml["MessageDetail"])[] = [
      "mnDocumentOrderInvoiceE_DOCO",
      "mnSequenceNoOperations_OPSQ",
    ];
    const areFieldsConsistent = txnList.every((txn) =>
      fieldsToCheck.every((field) => txn[field] === txnList[0][field]),
    );
    if (!areFieldsConsistent) {
      const message = `Invalid XML for OrderID ${txnList[0].MessageDetail.mnDocumentOrderInvoiceE_DOCO}`;
      context.error(message);
      await setTransactionManagerFailedStatus(fileGuid, message, context);
      return;
    }

    context.info("Getting Production Order from SAP");
    const orderId = `${txnList[0].MessageDetail.mnDocumentOrderInvoiceE_DOCO}`;

    const containerClient = new MyContainerClient(context, functionName);
    const productionOrderComponents = await getProductionOrderComponents(
      orderId,
      containerClient,
      context,
    );

    const variableReservationsByMaterial = new Map<string, Components>();
    for (const item of productionOrderComponents.d.results) {
      const material = item.Material;
      if (variableReservationsByMaterial.has(material)) continue;
      if (item.QuantityIsFixed == false) {
        const reservationInfo = {
          Material: item.Material,
          Reservation: item.Reservation,
          ReservationItem: item.ReservationItem,
        };
        variableReservationsByMaterial.set(material, reservationInfo);
      }
    }
    if (variableReservationsByMaterial.size === 0) {
      const message = `No reservation with variable quantity found for the Production Order ${orderId}.`;
      await setTransactionManagerFailedStatus(fileGuid, message, context);
      return;
    }

    // Send the Production Order Confirmation API requests
    context.info("Confirming Production Order using SAP API");
    const body = await getRequestBody(txnList, variableReservationsByMaterial);
    await sendProductionOrderConfirmation(
      body,
      containerClient,
      context,
      false,
    );

    // Log the successful processing of all messages
    const message = "Successfully confirmed Components Goods Issues";
    context.info(message);
    await setTransactionManagerCompletedStatus(fileGuid, message, context);
  } catch (error) {
    const message = `Failed to confirm Components Goods Issues: ${error}`;
    context.error(message);
    await setTransactionManagerFailedStatus(fileGuid, message, context);
  }
}

/**
 * @returns the request body for the Production Order Confirmation API
 */
async function getRequestBody(
  xml: ComponentsGoodsIssuesXml[],
  variableReservationsByMaterial: Map<string, Components>,
): Promise<ComponentGoodsIssuesRequest> {
  const materialDocumentItemList = [];
  for (const txn of xml) {
    const material = String(txn.MessageDetail.szItemNoUnknownFormat_UITM);
    if (!variableReservationsByMaterial.has(material)) {
      throw Error(
        `No reservation with variable quantity found for the material ${material}.`,
      );
    }
    let quantity = txn.MessageDetail.mnQuantityToIssue_QNTOW;
    let goodsMovementType = "261";
    if (quantity < 0) {
      goodsMovementType = "262";
      quantity *= -1;
    }
    const reservationInfo = variableReservationsByMaterial.get(material);
    const materialDocumentItem = {
      OrderID: `${txn.MessageDetail.mnDocumentOrderInvoiceE_DOCO}`,
      Material: `${txn.MessageDetail.szItemNoUnknownFormat_UITM}`,
      Reservation: `${reservationInfo.Reservation}`,
      ReservationItem: `${reservationInfo.ReservationItem}`,
      Plant: `${plantConversions.getSAPValue(txn.MessageDetail.szBranchPlant_MCU)}`,
      StorageLocation: "2000",
      GoodsMovementType: goodsMovementType,
      EntryUnitISOCode: `${uomConversions.getSAPValue(txn.MessageDetail.szUnitOfMeasureAsInput_UOM)}`,
      QuantityInEntryUnit: `${quantity}`,
      Batch: `${txn.MessageDetail.szLot_LOTN}`,
      EWMStorageBin: `${txn.MessageDetail.szLocation_LOCN}`,
      EWMWarehouse: `${plantConversions.getSAPValue(txn.MessageDetail.szBranchPlant_MCU)}`,
    };
    materialDocumentItemList.push(materialDocumentItem);
  }

  const body: ComponentGoodsIssuesRequest = {
    OrderID: `${xml[0].MessageDetail.mnDocumentOrderInvoiceE_DOCO}`,
    OrderOperation:
      `${xml[0].MessageDetail.mnSequenceNoOperations_OPSQ}`.padStart(4, "0"),
    Sequence: "00",
    to_ProdnOrdConfMatlDocItm: materialDocumentItemList,
  };

  return body;
}
