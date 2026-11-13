@IsTest
private class FcRecordServiceTest {
    @IsTest
    static void usesTheStandardNameField() {
        Account a = FcTestData.account('Acme');
        Assert.areEqual('Acme', FcRecordService.getNames(new List<Id>{ a.Id }).get(a.Id));
    }

    @IsTest
    static void usesTheAutoNumberNameFieldForCases() {
        Case c = new Case(Subject = 'Help');
        insert c;
        String caseNumber = [SELECT CaseNumber FROM Case WHERE Id = :c.Id].CaseNumber;
        Assert.areEqual(caseNumber, FcRecordService.getNames(new List<Id>{ c.Id }).get(c.Id));
    }

    @IsTest
    static void honoursAConfiguredNameField() {
        Account a = new Account(Name = 'Acme', Site = 'West Campus');
        insert a;
        FcRecordService.nameFieldOverrides = new Map<String, String>{ 'Account' => 'Site' };
        Assert.areEqual('West Campus', FcRecordService.getNames(new List<Id>{ a.Id }).get(a.Id));
    }

    @IsTest
    static void fallsBackToTheIdWhenTheNameIsBlank() {
        Account a = new Account(Name = 'Acme');
        insert a;
        FcRecordService.nameFieldOverrides = new Map<String, String>{ 'Account' => 'Site' };
        Assert.areEqual(String.valueOf(a.Id), FcRecordService.getNames(new List<Id>{ a.Id }).get(a.Id));
    }

    @IsTest
    static void namesRecordsOfSeveralObjectsAtOnce() {
        Account a = FcTestData.account('Acme');
        Contact c = new Contact(LastName = 'Rao', AccountId = a.Id);
        insert c;
        Map<Id, String> names = FcRecordService.getNames(new List<Id>{ a.Id, c.Id });
        Assert.areEqual('Acme', names.get(a.Id));
        Assert.areEqual('Rao', names.get(c.Id));
    }

    @IsTest
    static void leavesOutRecordsTheUserCannotSee() {
        Account a = FcTestData.account('Acme');
        Map<Id, String> names;
        System.runAs(FcTestData.userWithoutRecordAccess()) {
            names = FcRecordService.getNames(new List<Id>{ a.Id });
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
