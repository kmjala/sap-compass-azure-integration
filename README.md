# SAP Compass Azure integration

Azure integration layer between SAP and Compass to facilitate the integration between SAP and Compass.

See [TROUBLESHOOTING](TROUBLESHOOTING.md) on how to get access to the infrastructure, the logs, and how investigate and resolve errors.

## Repository structure

This repository defines its Azure infrastructure in the [main.bicep](./main.bicep) file.

The Azure Functions are in the [function-app/src/functions](./function-app/src/functions/) folder.

The Compass Azure Client is in the [SAP2COMPASS](./SAP2COMPASS) folder.

In larger context, the [sap-integration-azure-infrastructure](https://github.com/goreperformancesolution/sap-integration-azure-infrastructure) repository deploys Azure infrastructure that provides events and messages coming out of SAP, which are consumed by Azure Functions in this repository.

## Integration documentation

Birds-eye view documentation for the integrations between SAP and Compass

- [Routing outgoing Compass XMLs to Azure](docs/route-outgoing-compass-xmls.md)
- [SAP to Compass integrations](docs/sap-to-compass-integrations.md)

Ingeration specific documentation:

- [Goods Receipt (Compass to SAP)](docs/goods-receipt-to-sap.md)
- [Inspection Lot (SAP to Compass)](docs/inspection-lot-to-compass.md)
- [Inventory Location Move (SAP to Compass)](docs/inventory-location-move-to-compass.md)
- [Material Master (SAP to Compass)](docs/material-master-to-compass.md)
- [Production Order (SAP to Compass)](docs/production-order-to-compass.md)
- [Production Order Confirmation (Compass to SAP)](docs/production-order-confirmation-to-sap.md)

## Deployment

This repository uses environment variables and secrets to deploy its resources.

The initial deployment _might_ fail, because the [Function App identity](./bicep/function-app-identity.bicep) takes some time to be created, even though the operation is successful. This can cause the role assignemtns to fail, because the Principal ID isn't available yet. Solution is to just re-run the deployment again.

### Deploying to DEV, VAL and PRD

Any new commits to the `main` branch are deployed to the _Development_ environment, see [deploy-branch.yaml](.github/workflows/deploy-branch.yaml).

Deployments to the _Validation_ environments are triggered automatically upon successful deployment to the _Development_ environment. They can also be done manually through the [Deploy VAL](https://github.com/goreperformancesolution/sap-compass-azure-integration/actions/workflows/deploy-val.yaml) workflow, see [deploy-val.yaml](.github/workflows/deploy-val.yaml). Successful deployments of the `main` branch to the _Validation_ environment [create new release drafts](https://github.com/wlgore/action-create-release).

Any deployment to the _Validation_ environment has to be approved by someone in the [Required reviewers](https://github.com/goreperformancesolution/sap-compass-azure-integration/settings/environments/3631069170/edit) list.

Deployments to the _Production_ environment are triggered by publishing the release drafts, see [deploy-release.yaml](.github/workflows/deploy-release.yaml). Deployments to the production environment can also be manually triggered through the [Deploy release](https://github.com/goreperformancesolution/sap-compass-azure-integration/actions/workflows/deploy-release.yaml) workflow.

### Repository variables

- `AZURE_TENANT_ID` is the Azure tenant where the Azure resources are deployed to, see [Azure Resource Ids (wlgore/information)](https://wlgore.github.io/information/docs/azure/resource-ids/).

### Environment secrets

- `SAP_API_KEY` is the SAP API key for the API endpoint in the environment variable `SAP_BASE_URL`.

### Environment variables

- `AZURE_SUBSCRIPTION_ID` is the subscription to where the Azure resources are deployed to, see [Azure Resource Ids (wlgore/information)](https://wlgore.github.io/information/docs/azure/resource-ids/gore-performance-solutions).
- `SAP_BASE_URL` is the SAP API base url, e.g. `https://api.qa.sap.wlgore.com`.
- `SAP_SERVICE_BUS` is the Service Bus name of [sap-integration-azure-infrastructure](https://github.com/goreperformancesolution/sap-integration-azure-infrastructure).

### Access to SAP Service Bus

The Function App accesses the SAP topic subscriptions provided by the [sap-integration-azure-infrastructure](https://github.com/goreperformancesolution/sap-integration-azure-infrastructure) using a managed identity.

You need to add role assignments to the managed identity in [sap-integration-azure-infrastructure](https://github.com/goreperformancesolution/sap-integration-azure-infrastructure), so that it can access and be triggered by new messages arriving in the topic.

## Contributing

For developer instructions on how to set up the development environment, run the integration locally, and run the tests, see [CONTRIBUTING](CONTRIBUTING.md).
