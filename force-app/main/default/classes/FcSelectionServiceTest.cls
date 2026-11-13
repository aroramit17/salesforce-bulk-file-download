@IsTest
private class FcSelectionServiceTest {
    private static Map<String, List<Id>> byPath(Map<String, Object> result) {
        return (Map<String, List<Id>>) result.get('byPath');
    }

    @IsTest
    static void returnsChildRecordIds() {
        Account a = FcTestData.account('Acme');
        Contact c1 = new Contact(LastName = 'One', AccountId = a.Id);
        Contact c2 = new Contact(LastName = 'Two', AccountId = a.Id);
        insert new List<Contact>{ c1, c2 };
        insert new Contact(LastName = 'Elsewhere');

        Map<String, Object> result = FcSelectionService.getRelatedIds(a.Id, new List<String>{ 'Contacts' });

        Assert.areEqual(new Set<Id>{ c1.Id, c2.Id }, new Set<Id>(byPath(result).get('Contacts')));
        Assert.areEqual(0, ((List<String>) result.get('errors')).size());
    }

    @IsTest
    static void matchesRelationshipNamesWithoutRegardToCase() {
        Account a = FcTestData.account('Acme');
        Contact c = new Contact(LastName = 'One', AccountId = a.Id);
        insert c;
        Map<String, Object> result = FcSelectionService.getRelatedIds(a.Id, new List<String>{ ' contacts ' });
        Assert.areEqual(1, byPath(result).get('contacts').size());
    }

    @IsTest
    static void returnsGrandchildRecordIds() {
        Account a = FcTestData.account('Acme');
        Contact c = new Contact(LastName = 'One', AccountId = a.Id);
        insert c;
        Case k = new Case(Subject = 'Help', ContactId = c.Id);
        insert k;

        Map<String, Object> result = FcSelectionService.getRelatedIds(a.Id, new List<String>{ 'Contacts.Cases' });

        Assert.areEqual(new List<Id>{ k.Id }, byPath(result).get('Contacts.Cases'));
    }

    @IsTest
    static void reportsAnUnknownRelationshipAndStillLoadsTheRest() {
        Account a = FcTestData.account('Acme');
        Contact c = new Contact(LastName = 'One', AccountId = a.Id);
        insert c;

        Map<String, Object> result = FcSelectionService.getRelatedIds(a.Id, new List<String>{ 'Nonsense', 'Contacts', 'Contacts.Nope' });

        Assert.areEqual(1, byPath(result).get('Contacts').size());
        Assert.isFalse(byPath(result).containsKey('Nonsense'));
        List<String> errors = (List<String>) result.get('errors');
        Assert.areEqual(2, errors.size());
        Assert.isTrue(errors[0].contains('Nonsense'), errors[0]);
        Assert.isTrue(errors[1].contains('Nope'), errors[1]);
    }

    @IsTest
    static void rejectsPathsDeeperThanTwoLevels() {
        Account a = FcTestData.account('Acme');
        Map<String, Object> result = FcSelectionService.getRelatedIds(a.Id, new List<String>{ 'Contacts.Cases.Attachments' });
        Assert.areEqual(1, ((List<String>) result.get('errors')).size());
    }

    @IsTest
    static void findsRecordsByName() {
        Account a = FcTestData.account('Harbor Freight');
        Test.setFixedSearchResults(new List<Id>{ a.Id });

        List<Map<String, String>> found = FcSelectionService.searchRecords('Account', 'Harb');

        Assert.areEqual(1, found.size());
        Assert.areEqual(String.valueOf(a.Id), found[0].get('id'));
        Assert.areEqual('Harbor Freight', found[0].get('name'));
    }

    @IsTest
    static void treatsSearchPunctuationAndOperatorsAsText() {
        Account a = FcTestData.account('O\'Brien "x"');
        Test.setFixedSearchResults(new List<Id>{ a.Id });
        List<Map<String, String>> found = FcSelectionService.searchRecords('Account', 'O\'Brien "x" AND -y \\ (z) OR');
        Assert.areEqual(1, found.size());
    }

    @IsTest
    static void returnsNothingForAShortOrEmptySearch() {
        Assert.areEqual(0, FcSelectionService.searchRecords('Account', ' a ').size());
        Assert.areEqual(0, FcSelectionService.searchRecords('Account', null).size());
        Assert.areEqual(0, FcSelectionService.searchRecords('Account', '* ?').size());
    }

    @IsTest
    static void rejectsASearchOnAnUnknownObject() {
        try {
            FcSelectionService.searchRecords('Account) RETURNING User(Id', 'abc');
            Assert.fail('Expected an exception');
        } catch (AuraHandledException e) {
            Assert.isTrue(true);
        }
    }

    private static void assertRejected(String soql) {
        try {
            FcSelectionService.runQuery(soql);
            Assert.fail('Expected rejection of: ' + soql);
        } catch (AuraHandledException e) {
            Assert.isTrue(true);
        }
    }

    @IsTest
    static void runsASelectIdQueryForAUserWithThePermission() {
        Account a = FcTestData.account('Acme');
        Account b = FcTestData.account('Globex');
        User admin;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            admin = FcTestData.userWithPermissionSet('FileCrate_Admin');
        }
        List<Id> ids;
        Boolean allowed;
        System.runAs(admin) {
            allowed = FcSelectionService.canRunSoql();
            ids = FcSelectionService.runQuery('select id from Account where Name = \'Acme\'');
        }
        Assert.areEqual(true, allowed);
        Assert.areEqual(new List<Id>{ a.Id }, ids);
    }

    @IsTest
    static void refusesToRunForAUserWithoutThePermission() {
        FcTestData.account('Acme');
        User plain;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            plain = FcTestData.userWithPermissionSet('FileCrate_User');
        }
        System.runAs(plain) {
            Assert.areEqual(false, FcSelectionService.canRunSoql());
            assertRejected('SELECT Id FROM Account');
        }
    }

    @IsTest
    static void acceptsOnlyAPlainSelectId() {
        User admin;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            admin = FcTestData.userWithPermissionSet('FileCrate_Admin');
        }
        System.runAs(admin) {
            assertRejected('SELECT Name FROM Account');
            assertRejected('SELECT Id, Name FROM Account');
            assertRejected('SELECT Id, (SELECT Id FROM Contacts) FROM Account');
            assertRejected('DELETE FROM Account');
            assertRejected('SELECT Id FROM Account; SELECT Id FROM Contact');
            assertRejected('SELECT Id FROM NoSuchObject__c');
            assertRejected('SELECT Id FROM Account LIMIT 20000');
            assertRejected('SELECT Id FROM Account WHERE (');
            assertRejected('');
            assertRejected(null);
        }
    }

    @IsTest
    static void capsUnlimitedQueries() {
        Assert.areEqual('SELECT Id FROM Account LIMIT 10000', FcSelectionService.withLimit('SELECT Id FROM Account'));
        Assert.areEqual('SELECT Id FROM Account limit 50', FcSelectionService.withLimit('SELECT Id FROM Account limit 50'));
        Assert.areEqual(
            'SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact LIMIT 5) LIMIT 10000',
            FcSelectionService.withLimit('SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact LIMIT 5)')
        );
    }
}
