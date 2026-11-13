@IsTest
private class FcSetupServiceTest {
    @IsTest
    static void reportsSettingsStorageAndPermissions() {
        Map<String, Object> status = FcSetupService.getStatus();
        Map<String, Object> settings = (Map<String, Object>) status.get('settings');
        Assert.isTrue(settings.containsKey('maxZipMb'));
        Map<String, Object> fileStorage = (Map<String, Object>) status.get('fileStorage');
        Assert.isTrue(fileStorage.containsKey('usedMb'));
        Assert.isTrue(fileStorage.containsKey('maxMb'));
        Map<String, Object> dataStorage = (Map<String, Object>) status.get('dataStorage');
        Assert.isTrue(dataStorage.containsKey('usedMb'));
        Assert.isNotNull(status.get('canRunSoql'));
        Assert.isNotNull(status.get('canReadEventLogs'));
        Assert.areEqual('66.0', status.get('apiVersion'));
    }
}
