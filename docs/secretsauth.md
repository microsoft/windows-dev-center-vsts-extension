# Using secret and Azure Resource Manager service connection to authenticate to Windows Store Partner Center

## Prerequisites
You must have an Azure Active Directory (AAD) and owner access of it. See [setup.md](setup.md) for details.

## Step 1: Adding App Secret to your Azure AD application
Go to Azure portal and find your Azure AD application, and do the following steps.

1. Go to **Manage** > **Certificates & secrets**.
2. Select **Client Secrets**.
3. Select **New Client Secret**.
4. Enter your **Description** for the secret and set an **Expire** time.


## Step 2: Creating a service connection
The v3\* version of service connection requires using Azure resource manager service connection regardless of what type of authentication scheme you use. So even if you want to keep using App secret, you need to switch to Azure resource manager service connection. Here are the steps to do it:
1. Go to project settings -> Service Connection click on “New Service Connection”. Select Azure Resource Manager, and then select Service Principal (Manual) for authentication method. 
2. Fill in the service principal ID and tenant ID with the client ID and tenant of your Azure AD application.
3. For credential, select "Service Principal Key", and fill up the field "Service Principal Key" with the Azure AD secret you created.
4. If you have an Azure subscription in the same tenant as your service principal, then you can fill in the subscription ID and subscription Name with those of your Azure subscription. It's not mandatory for you to provide the subscription ID and subscription name in order to run the Windows Store extension. You can simply provide any value for subscription ID and subscription name as shown in the screenshot above, and do "save without verification" to create the service connection. To save without doing any verification, you can click on the dropdown on the right of the button "verify and save".

## Step 3: Adding the Service Connection to your Pipeline
Make sure you add the service connection to your extension task in your pipeline. If you are using classic release pipeline, you can add the service connection directly using the UI. If you are maintaining a YAML pipeline, you should add the service connection to the serviceEndpoint field under inputs. E.g. 

```
- task: MS-RDX-MRO.windows-store-publish-dev.flight-task.store-flight@3
  displayName: 'Publish'
  inputs:
    serviceEndpoint: <YOUR SERVICE ENDPOINT NAME> 
    appId: XXX
    flightNameType: FlightName
    flightName: XXX
    sourceFolder: XXX
    contents: XXX
```