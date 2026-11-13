@IsTest
private class FcEngineControllerTest {
    @IsTest
    static void exposesTheApiVersion() {
        Assert.areEqual('66.0', new FcEngineController().getApiVersion());
    }

    @IsTest
    static void pointsAtTheLightningOrigin() {
        String origin = new FcEngineController().getLightningOrigin();
        Assert.isTrue(origin.startsWith('https://'), origin);
        Assert.isTrue(origin.endsWith('.lightning.force.com'), origin);
        Assert.isFalse(origin.contains('.my.salesforce.com'), origin);
    }

    @IsTest
    static void convertsSandboxAndProductionDomains() {
        Assert.areEqual('https://acme.lightning.force.com', FcEngineController.lightningOriginFor('acme.my.salesforce.com'));
        Assert.areEqual(
            'https://acme--uat.sandbox.lightning.force.com',
            FcEngineController.lightningOriginFor('acme--uat.sandbox.my.salesforce.com')
        );
    }

    @IsTest
    static void exposesTheOrgBaseUrl() {
        Assert.isTrue(new FcEngineController().getBaseUrl().startsWith('https://'));
    }
}
