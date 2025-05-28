# Goods Receipt to SAP

Feature spec is [features/goods-receipt-to-sap.feature](../features/goods-receipt-to-sap.feature).

This integration relates to _IDD0614 Receive Production Receipt and Batch_.

```mermaid
flowchart
  subgraph Compass Server
    mes[Compass]
    outputFolder[Compass Output Folder]
    mes -->|"Compass writes a new SuperBackFlush XML"| outputFolder

    mesAzureClient["Compass Azure Client"]
    outputFolder -->|New files are picked up| mesAzureClient
  end

  subgraph Azure
    outputXmlTopic["compass-output-xml
    (Service Bus Topic)"]
    mesAzureClient -->|"XML file is pushed (as-is) to the Azure topic"| outputXmlTopic

    routeCompassOutputFunction["Route Compass Output
    (Azure Function)"]
    outputXmlTopic -->|Azure Function inspects the XML file| routeCompassOutputFunction

    %% SuperBackFlush
    superbackflushTopic["superbackflush-from-compass-v1
    (Service Bus Topic)"]
    routeCompassOutputFunction -->|Function identifies the XML as SuperBackFlush and sends it to the SuperBackFlush topic| superbackflushTopic

    productionReceiptFunction["Production Receipt to SAP
    (Azure Function)"]
    superbackflushTopic -->|A Function is triggered to update SAP| productionReceiptFunction
  end

  subgraph SAP
    productionOrderConfirmationSapApi["Production Order Confirmation API
    (SAP BTP)"]
    productionReceiptFunction -->|The Function calls the SAP API| productionOrderConfirmationSapApi
    s4["SAP S/4"]
    productionOrderConfirmationSapApi -->|"API updates SAP S/4"| s4
  end
```

## Receive SuperBackFlush XMLs from Compass

The _Compass Azure Client_ monitors the Compass output folder for new XML files and publishes them to Azure. For more details on this process, see [Route outgoing Compass XMLs](./route-outgoing-compass-xmls.md).

Relevant for this integration are XML files with a `<MessageType>` of `SuperBackFlush`, which are published to a topic subscription for the `goods-receipt-to-sap` Function:

- [Topic subscription for the `goods-receipt-to-sap` Function (DEV)](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417/providers/Microsoft.ServiceBus/namespaces/sbn-uivtxalxpuii2/topics/superbackflush-from-compass-v1/subscriptions/superbackflush-from-compass-v1-to-sap-function/explorer)
- [Topic subscription for the `goods-receipt-to-sap` Function (VAL)](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-6592bc8064206952043ec5110cdc8bf25ff1489b/providers/Microsoft.ServiceBus/namespaces/sbn-k7nqx5nlh6fcs/topics/superbackflush-from-compass-v1/subscriptions/superbackflush-from-compass-v1-to-sap-function/explorer)
- Topic subscription for the `goods-receipt-to-sap` Function (PRD)

## Azure to SAP

From there, the Azure Function [`goods-receipt-to-sap`](../function-app/src/functions/compass-to-sap/goods-receipt-to-sap.ts) consumes the messages.

For each `<TxnWrapper>`, the following steps are performed:

1. Stop processing this `<TxnWrapper>` if it not a goods receipt
1. Stop processing this `<TxnWrapper>` if it not for a mapped plant, see [plant.csv](../function-app/src/conversions/plant.csv)
1. Perform the translation from [goods-receipt-to-sap.xslx](../features/goods-receipt-to-sap.xlsx)
1. Invoke the [Production Order Confirmation API](https://api.sap.com/api/OP_API_PROD_ORDER_CONFIRMATIO_2_SRV_0001/path/post_ProdnOrdConf2)
1. Mark the file as completed in the Compass transaction manager

All payloads are stored in Azure, the exact location for each Function invocation is printed in the logs. For more details, see [TROUBLESHOOTING.md](../TROUBLESHOOTING.md#accessing-payloads).

```log
[2024-10-18T12:51:33.794Z] Blob location is topic=goods-receipt-to-sap/year=2024/month=10/day=18/mid=add70b2688164cddb27d84d9eddc13f8/
```

## Logs

See [TROUBLESHOOTING.md](../TROUBLESHOOTING.md#accessing-the-logs) on how to access the logs.

## Updating the mapping

Follow the steps below to update the mapping from the incoming SAP message to the Compass XML file:

1. Document the change in [goods-receipt-to-sap.xlsx](../features/goods-receipt-to-sap.xlsx)
1. Add the mapped fields of the incoming `SuperBackFlushTxnWrapper` in [route-compass-output.d.ts](../function-app/src/functions/compass-to-sap/route-compass-output.d.ts)

   The `SuperBackFlushTxnWrapper` currently only contains the fields that are also currently mapped. You can see the entire SAP message with all available fields in the `input.xml` file(s) in the Azure Blob Container `message-archive` under `topic=goods-receipt-to-sap`.

1. Update the XML text with the new mapping(s) in the `getRequestBody(...)` method of [goods-receipt-to-sap.ts](../function-app/src/functions/compass-to-sap/goods-receipt-to-sap.ts)
1. Update the expected SAP request bodies in [goods-receipt-to-sap](../function-app/test/compass-to-sap/goods-receipt-to-sap/)
