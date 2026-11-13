@IsTest
private class FcRecordServiceTest {
    @IsTest
    static void usesTheStandardNameField() {
        FcJob__c job = new FcJob__c();
        insert job;
        String autoNumber = [SELECT Name FROM FcJob__c WHERE Id = :job.Id].Name;
        Assert.areEqual(autoNumber, FcRecordService.getNames(new List<Id>{ job.Id }).get(job.Id));
    }

    @IsTest
    static void honoursAConfiguredNameField() {
        System.runAs(FcTestData.runner()) {
            FcJob__c job = FcTestData.record('West Campus');
            Assert.areEqual('West Campus', FcRecordService.getNames(new List<Id>{ job.Id }).get(job.Id));
        }
    }

    @IsTest
    static void ignoresAConfiguredFieldThatDoesNotExist() {
        FcJob__c job = new FcJob__c();
        insert job;
        FcRecordService.nameFieldOverrides = new Map<String, String>{ 'FcJob__c' => 'No_Such_Field__c' };
        String autoNumber = [SELECT Name FROM FcJob__c WHERE Id = :job.Id].Name;
        Assert.areEqual(autoNumber, FcRecordService.getNames(new List<Id>{ job.Id }).get(job.Id));
    }

    @IsTest
    static void fallsBackToTheIdWhenTheNameIsBlank() {
        FcJob__c job = FcTestData.record(null);
        Assert.areEqual(String.valueOf(job.Id), FcRecordService.getNames(new List<Id>{ job.Id }).get(job.Id));
    }

    @IsTest
    static void namesRecordsOfSeveralObjectsAtOnce() {
        System.runAs(FcTestData.runner()) {
            FcJob__c job = FcTestData.record('Acme');
            Id me = UserInfo.getUserId();
            Map<Id, String> names = FcRecordService.getNames(new List<Id>{ job.Id, me });
            Assert.areEqual('Acme', names.get(job.Id));
            Assert.areEqual(UserInfo.getName(), names.get(me));
        }
    }

    @IsTest
    static void leavesOutRecordsTheUserCannotSee() {
        FcJob__c job = FcTestData.record('Acme');
        Map<Id, String> names;
        System.runAs(FcTestData.userWithoutRecordAccess()) {
            names = FcRecordService.getNames(new List<Id>{ job.Id });
        }
        Assert.areEqual(0, names.size());
    }

    @IsTest
    static void listsObjectsIncludingAccount() {
        Boolean found = false;
        for (Map<String, String> o : FcRecordService.getObjects()) {
            if (o.get('value') == 'Account') {
                found = true;
                Assert.areEqual('Account', o.get('label'));
            }
        }
        Assert.isTrue(found, 'Account should be offered');
    }

    @IsTest
    static void doesNotOfferSetupObjects() {
        for (Map<String, String> o : FcRecordService.getObjects()) {
            Assert.areNotEqual('ApexClass', o.get('value'));
            Assert.areNotEqual('ApexTrigger', o.get('value'));
        }
    }

    @IsTest
    static void listsListViewsForAnObject() {
        List<Map<String, String>> views = FcRecordService.getListViews('Account');
        Assert.isNotNull(views);
        for (Map<String, String> v : views) {
            Assert.isTrue(v.get('value').startsWith('00B'), v.get('value'));
            Assert.isNotNull(v.get('label'));
        }
    }
}
