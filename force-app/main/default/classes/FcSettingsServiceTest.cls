@IsTest
private class FcSettingsServiceTest {
    @IsTest
    static void fallsBackToDefaultsWhenThereIsNoRecord() {
        Map<String, Object> s = FcSettingsService.fromRecord(null);
        Assert.areEqual(500, (Integer) s.get('maxFilesPerZip'));
        Assert.areEqual(1500, (Integer) s.get('maxZipMb'));
        Assert.areEqual(true, s.get('includeAttachments'));
        Assert.areEqual(true, s.get('includeNotes'));
        Assert.areEqual(true, s.get('latestVersionOnly'));
        Assert.areEqual('{RecordName}_{Title}.{ext}', s.get('namePattern'));
        Assert.areEqual('PerRecord', s.get('folderLayout'));
    }

    @IsTest
    static void readsValuesFromTheRecord() {
        FcSettings__mdt record = new FcSettings__mdt(
            MaxFilesPerZip__c = 50, MaxZipMB__c = 10, IncludeAttachments__c = false, IncludeNotes__c = false,
            LatestVersionOnly__c = false, NamePattern__c = '{Title}.{ext}', FolderLayout__c = 'Flat'
        );
        Map<String, Object> s = FcSettingsService.fromRecord(record);
        Assert.areEqual(50, (Integer) s.get('maxFilesPerZip'));
        Assert.areEqual(10, (Integer) s.get('maxZipMb'));
        Assert.areEqual(false, s.get('includeAttachments'));
        Assert.areEqual(false, s.get('includeNotes'));
        Assert.areEqual(false, s.get('latestVersionOnly'));
        Assert.areEqual('{Title}.{ext}', s.get('namePattern'));
        Assert.areEqual('Flat', s.get('folderLayout'));
    }

    @IsTest
    static void fillsBlankFieldsWithDefaults() {
        Map<String, Object> s = FcSettingsService.fromRecord(new FcSettings__mdt(MaxZipMB__c = 10));
        Assert.areEqual(500, (Integer) s.get('maxFilesPerZip'));
        Assert.areEqual('{RecordName}_{Title}.{ext}', s.get('namePattern'));
        Assert.areEqual('PerRecord', s.get('folderLayout'));
    }

    @IsTest
    static void capsTheZipSizeBelowTheFormatLimit() {
        Map<String, Object> s = FcSettingsService.fromRecord(new FcSettings__mdt(MaxZipMB__c = 99999, MaxFilesPerZip__c = 999999));
        Assert.areEqual(3500, (Integer) s.get('maxZipMb'));
        Assert.areEqual(60000, (Integer) s.get('maxFilesPerZip'));
    }

    @IsTest
    static void servesSettingsToTheComponents() {
        Assert.isTrue(FcSettingsService.getSettings().containsKey('maxZipMb'));
    }
}
