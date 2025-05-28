# Troubleshooting

This document covers how to investigate and resolve errors.

## Access to the infrastructure

Grant access to the Azure resources by [assigning users to the following roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/quickstart-assign-role-user-portal#grant-access) on the resource group:

- _Reader_ for users who only need to view the resources.

  **This is the preferred role to avoid accidental mistakes that could impact the integration and cause incidents.** You don't have to worry about accidentally breaking things, this only grants a read-only permissions.

- _Contributor_ and [_Storage Blob Data Owner_](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-data-operations-portal?source=recommendations#permissions-needed-to-access-blob-data) for users who support this integration.

  **This will allow users to make changes that can impact the integration and cause incidents.** This is akin to super-user or administrator access.

This has to be done for each resource group of an environment:

- [rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417/users) (DEV)
- [rg-arb-6592bc8064206952043ec5110cdc8bf25ff1489b](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/d5c0187e-4b27-48b7-8592-f28f897fed9c/resourceGroups/rg-arb-6592bc8064206952043ec5110cdc8bf25ff1489b/users) (VAL)
- [rg-arb-09d013d70dfd3515838a611345a76a7641a09d22](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/dc554c52-a946-4663-993f-ad838cc62de9/resourceGroups/rg-arb-09d013d70dfd3515838a611345a76a7641a09d22/overview) (PRD)

> [!TIP]
> Members of the _GPS IT Manufacturing Team_ gain access through the Entra ID _Azure - GPS - GPS IT Manufacturing Team_ group.
>
> 1. Group maintainers (ask Associates from the team) go to [My Groups &rarr; Groups I own &rarr; Azure - GPS - GPS IT Manufacturing Team](https://myaccount.microsoft.com/groups/7241c2d5-2ff3-40b8-a597-b05fe7a066f0)
> 2. Click on the **Members** tab
> 3. Click on the _Add_ button and search for the user
> 4. Click on the _Add_ button
>
> The user now has access to the Azure resources (all environments) with the elevated permissions of this team.

## Accessing the logs

All integration-related logs are stored in Azure and can be accessed through Application Insights. Two places are very useful: The _Transaction search_ and the _Failures_ tab.

Use the _Transaction search_ tab to search for specific messages, e.g. a Material or Production Order.

- [Application Insights &rarr; Transaction Search](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417/providers/Microsoft.Insights/components/ai-uivtxalxpuii2/searchV1) (DEV)
- [Application Insights &rarr; Transaction Search](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/d5c0187e-4b27-48b7-8592-f28f897fed9c/resourceGroups/rg-arb-6592bc8064206952043ec5110cdc8bf25ff1489b/providers/Microsoft.Insights/components/ai-k7nqx5nlh6fcs/searchV1) (VAL)
- [Application Insights &rarr; Transaction Search](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/dc554c52-a946-4663-993f-ad838cc62de9/resourceGroups/rg-arb-09d013d70dfd3515838a611345a76a7641a09d22/providers/Microsoft.Insights/components/ai-ir3xrw26w2gp6/searchV1) (PRD)

Use the _Failures_ tab to quickly get an overview over messages that errored out and further investigate them:

- [Application Insights &rarr; Failures](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417/providers/Microsoft.Insights/components/ai-uivtxalxpuii2/failures) (DEV)
- [Application Insights &rarr; Failures](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/d5c0187e-4b27-48b7-8592-f28f897fed9c/resourceGroups/rg-arb-6592bc8064206952043ec5110cdc8bf25ff1489b/providers/Microsoft.Insights/components/ai-k7nqx5nlh6fcs/failures) (VAL)
- [Application Insights &rarr; Failures](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/dc554c52-a946-4663-993f-ad838cc62de9/resourceGroups/rg-arb-09d013d70dfd3515838a611345a76a7641a09d22/providers/Microsoft.Insights/components/ai-ir3xrw26w2gp6/failures) (PRD)

## Accessing payloads

All integrations store payloads they are processing, e.g. incoming XMLs and SAP API request/responses, in the `message-archive` Azure Blob Storage:

- [Azure Blob Storage `message-archive` (DEV)](https://portal.azure.com/#view/Microsoft_Azure_Storage/ContainerMenuBlade/~/overview/storageAccountId/%2Fsubscriptions%2Fe2fda199-cfde-4565-9bb3-08b676d05cc2%2FresourceGroups%2Frg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417%2Fproviders%2FMicrosoft.Storage%2FstorageAccounts%2Fsauivtxalxpuii2/path/message-archive/etag/%220x8DD0B0AF0FB1AAF%22/defaultEncryptionScope/%24account-encryption-key/denyEncryptionScopeOverride~/false/defaultId//publicAccessVal/None)
- [Azure Blob Storage `message-archive` (VAL)](https://portal.azure.com/#view/Microsoft_Azure_Storage/ContainerMenuBlade/~/overview/storageAccountId/%2Fsubscriptions%2Fd5c0187e-4b27-48b7-8592-f28f897fed9c%2FresourceGroups%2Frg-arb-6592bc8064206952043ec5110cdc8bf25ff1489b%2Fproviders%2FMicrosoft.Storage%2FstorageAccounts%2Fsak7nqx5nlh6fcs/path/message-archive/etag/%220x8DD0B0959922FFC%22/defaultEncryptionScope/%24account-encryption-key/denyEncryptionScopeOverride~/false/defaultId//publicAccessVal/None)
- Azure Blob Storage `message-archive` (PRD)

The file location is under `topic=<function name>/` and the exact location for each Function invocation is printed in the logs:

```log
[2024-10-18T12:51:33.794Z] Blob location is topic=components-goods-issues-to-sap/year=2024/month=10/day=18/mid=add70b2688164cddb27d84d9eddc13f8/
```

## Known errors

### SAP API down/circuit breaker

This error can occur in the following integrations:

- [Components Goods Issues to SAP](docs/components-goods-issues-to-sap.md)
- [Goods Receipt to SAP](docs/goods-receipt-to-sap.md)
- [Production Order Confirmation to SAP](docs/production-order-confirmation-to-sap.md)

This issue shows the following errors in the logs:

- Unable to open connection to backend system
- Connection to the backend is timeout. Gateway Timeout Error
- Circuit Breaker is enabled as backend is unhealthy

They all result from the SAP API backend receiving too many requests.

The messages sent by the MES to the Azure layer will fail and land in the Dead Letter Queue (DLQ). If the message can not be re-sent from the MES, then resolve this issue by re-sending the failed message from the DLQ:

1. Assert that there is no SAP downtime.
2. Navigate to the Service Bus topic.
   - [Service Bus &rarr; Topics](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417/providers/Microsoft.ServiceBus/namespaces/sbn-uivtxalxpuii2/topics) (DEV)
   - [Service Bus &rarr; Topics](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/d5c0187e-4b27-48b7-8592-f28f897fed9c/resourceGroups/rg-arb-6592bc8064206952043ec5110cdc8bf25ff1489b/providers/Microsoft.ServiceBus/namespaces/sbn-k7nqx5nlh6fcs/topics) (VAL)
   - [Service Bus &rarr; Topics](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/dc554c52-a946-4663-993f-ad838cc62de9/resourceGroups/rg-arb-09d013d70dfd3515838a611345a76a7641a09d22/providers/Microsoft.ServiceBus/namespaces/sbn-ir3xrw26w2gp6/topics) (PRD)
3. Select the topic corresponding to the Function that failed.
4. Go to _Subscriptions_ and select the one corresponding to the Function that failed.
5. Go to _Service Bus Explorer_ and select the _Dead-letter_ tab,
6. Change from _Peek Mode_ to _Receive Mode_.
7. Click _Receive messages_ and adjust _Number of messages to receive_ to a higher number to ensure that you will see the message that failed.

   **IMPORTANT:** Be sure to leave _PeekLock_ checked, do not select _ReceiveAndDelete_.

8. Select the message that you want to resubmit, e.g. comparing the logs with the _Message ID_ or _Enqueued Time_.
9. Click _Re-send selected message_.
10. After it was re-sent, click on _Complete_ to remove this message from the DLQ.

The message will now be re-processed. If it fails again, it will show up again in the DLQ from where you can re-send it again once SAP is reachable again.
