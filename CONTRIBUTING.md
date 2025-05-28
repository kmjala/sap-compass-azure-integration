# Contributing

## Where is the processing logic done?

All processing logic, e.g. translating unit of measure codes from SAP to Compass, is done in the [Azure Function App](./function-app/).

The exceptions to this rule, when logic can be implemented in the [Compass Azure client](./SAP2COMPASS/), are:

- If database connections to the MES are required
- Reading or writing to the file system of the MES

While both scenarios _can_ be done in the Azure layer, we choose not to, mainly because failure scenarios can currently be easier supported if they are in the Compass Azure client.

If these scenarios occur, the team decides if the logic will be implemented in the [Azure Function App](./function-app/) or in the [Compass Azure client](./SAP2COMPASS/).

## Run locally

You can run the Functions locally in the development environment using the following steps:

1. Assert you have the _Contributor_ and _Storage Blob Data Owner_ role on the [Compass resource group](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417/users) and sign in using the terminal

   ```sh
   az login

   # In the prompt, select "GPS Development" (e2fda199-cfde-4565-9bb3-08b676d05cc2)
   ```

1. Disable the Function(s) you want to run in the [Azure Portal](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417/providers/Microsoft.Web/sites/fa-uivtxalxpuii2/appServices)

1. Create the `function-app/local.settings.json` file using the template [`functiona-app/local.settings.json.template`](./function-app/local.settings.json.template)

1. Populate `APPLICATIONINSIGHTS_CONNECTION_STRING` with the following value

   ```sh
   az resource show --resource-group rg-arb-406c7858f033cd27c6cf5c3530980ecd50d70417 --name ai-uivtxalxpuii2 --resource-type "microsoft.insights/components" --query properties.InstrumentationKey --output tsv
   ```

1. Populate `SapServiceBusConnection` with the _Primary Connection String_ in [Service Bus &rarr; Settings &rarr; Shared access policies &rarr; RootManageSharedAccessKey](https://portal.azure.com/#@wlgore.onmicrosoft.com/resource/subscriptions/e2fda199-cfde-4565-9bb3-08b676d05cc2/resourceGroups/rg-arb-8f9b03a7c50e787f9a6a332d6d10a85723251c54/providers/Microsoft.ServiceBus/namespaces/sbn-uudmmlrz377qq/saskey)

   ```sh
   az servicebus namespace authorization-rule keys list --resource-group rg-arb-8f9b03a7c50e787f9a6a332d6d10a85723251c54 --namespace-name sbn-uudmmlrz377qq --name RootManageSharedAccessKey --query primaryConnectionString --output tsv
   ```

1. Populate `SAP_API_KEY` with the SAP API key provided by the SAP integrations team.

1. Run the Function(s) locally. The Function name(s) can be found in `function-app/functions/**/*.ts`.

   ```sh
   cd function-app

   # Only once to install the dependencies
   npm ci

   # Run one particular Function
   npm run start -- --functions <function name>

   # Run all Functions
   npm run start
   ```

## Husky

This repository uses [husky](https://typicode.github.io/husky) to automatically [run checks](./function-app/.husky/pre-commit) in the background while you create and push Git commits.

While this should work without issues, it can happen that Git clients like [git-fork](https://git-fork.com/) produce `npm: command not found` errors. This happens, because the Git client does not have the same `PATH` variable as your terminal and, for example, does not have `npm` set up.

The solution is outlined in the [husky FAQ: Node Version Managers and GUIs](https://typicode.github.io/husky/how-to.html#node-version-managers-and-guis).

For example for nvm, create the following file and restart the Git client to resolve the error:

```sh
# ~/.config/husky/init.sh

# See https://typicode.github.io/husky/how-to.html#node-version-managers-and-guis
export NVM_DIR="$HOME/.nvm"

# This loads nvm
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```
