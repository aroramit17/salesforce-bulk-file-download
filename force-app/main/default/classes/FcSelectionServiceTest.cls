@IsTest
private class FcSelectionServiceTest {
    private static Map<String, List<Id>> byPath(Map<String, Object> result) {
        return (Map<String, List<Id>>) result.get('byPath');
    }

    @IsTest
    static void returnsChildRecordIds() {
        FcJob__c job = FcTestData.record('Acme');
        Attachment one = FcTestData.attachment(job.Id, 'one.txt', 'a');
        Attachment two = FcTestData.attachment(job.Id, 'two.txt', 'b');
        FcTestData.attachment(FcTestData.record('Elsewhere').Id, 'other.txt', 'c');

        Map<String, Object> result = FcSelectionService.getRelatedIds(job.Id, new List<String>{ 'Attachments' });

        Assert.areEqual(new Set<Id>{ one.Id, two.Id }, new Set<Id>(byPath(result).get('Attachments')));
        Assert.areEqual(0, ((List<String>) result.get('errors')).size());
    }

    @IsTest
    static void matchesRelationshipNamesWithoutRegardToCase() {
        FcJob__c job = FcTestData.record('Acme');
        FcTestData.attachment(job.Id, 'one.txt', 'a');
        Map<String, Object> result = FcSelectionService.getRelatedIds(job.Id, new List<String>{ ' attachments ' });
        Assert.areEqual(1, byPath(result).get('attachments').size());
    }

    @IsTest
    static void returnsGrandchildRecordIds() {
        // Root: the running user. Child: a user they manage. Grandchild: that user's permission set assignments.
        User managed;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            managed = FcTestData.userWithPermissionSet('FileCrate_User');
            managed.ManagerId = UserInfo.getUserId();
            update managed;
        }

        Map<String, Object> result = FcSelectionService.getRelatedIds(
            UserInfo.getUserId(),
            new List<String>{ 'ManagedUsers', 'ManagedUsers.PermissionSetAssignments' }
        );

        Assert.isTrue(byPath(result).get('ManagedUsers').contains(managed.Id), 'The managed user is a child');
        Set<Id> grandchildren = new Set<Id>(byPath(result).get('ManagedUsers.PermissionSetAssignments'));
        Id assignment = [SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = :managed.Id AND PermissionSet.Name = 'FileCrate_User'].Id;
        Assert.isTrue(grandchildren.contains(assignment), 'The managed user\'s assignment is a grandchild');
        Assert.areEqual(0, ((List<String>) result.get('errors')).size());
    }

    @IsTest
    static void reportsAnUnknownRelationshipAndStillLoadsTheRest() {
        FcJob__c job = FcTestData.record('Acme');
        FcTestData.attachment(job.Id, 'one.txt', 'a');

        Map<String, Object> result = FcSelectionService.getRelatedIds(job.Id, new List<String>{ 'Nonsense', 'Attachments', 'Attachments.Nope' });

        Assert.areEqual(1, byPath(result).get('Attachments').size());
        Assert.isFalse(byPath(result).containsKey('Nonsense'));
        List<String> errors = (List<String>) result.get('errors');
        Assert.areEqual(2, errors.size());
        Assert.isTrue(errors[0].contains('Nonsense'), errors[0]);
        Assert.isTrue(errors[1].contains('Nope'), errors[1]);
    }

    @IsTest
    static void rejectsPathsDeeperThanTwoLevels() {
        FcJob__c job = FcTestData.record('Acme');
        Map<String, Object> result = FcSelectionService.getRelatedIds(job.Id, new List<String>{ 'Attachments.Notes.More' });
        Assert.areEqual(1, ((List<String>) result.get('errors')).size());
    }

    @IsTest
    static void findsRecordsByName() {
        Id me = UserInfo.getUserId();
        Test.setFixedSearchResults(new List<Id>{ me });

        List<Map<String, String>> found = FcSelectionService.searchRecords('User', 'Someone');

        Assert.areEqual(1, found.size());
        Assert.areEqual(String.valueOf(me), found[0].get('id'));
        Assert.areEqual(UserInfo.getName(), found[0].get('name'));
    }

    @IsTest
    static void treatsSearchPunctuationAndOperatorsAsText() {
        Test.setFixedSearchResults(new List<Id>{ UserInfo.getUserId() });
        List<Map<String, String>> found = FcSelectionService.searchRecords('User', 'O\'Brien "x" AND -y \\ (z) OR');
        Assert.areEqual(1, found.size());
        Assert.areEqual('Brien* AND xx*', FcSelectionService.searchTextFor('O\'Brien "xx" AND -y \\ (z) OR'));
    }

    @IsTest
    static void returnsNothingForAShortOrEmptySearch() {
        Assert.areEqual(0, FcSelectionService.searchRecords('User', ' a ').size());
        Assert.areEqual(0, FcSelectionService.searchRecords('User', null).size());
        Assert.areEqual(0, FcSelectionService.searchRecords('User', '* ?').size());
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
        FcJob__c a = FcTestData.record('Acme');
        FcTestData.record('Globex');
        User admin;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            admin = FcTestData.userWithPermissionSet('FileCrate_Admin');
        }
        List<Id> ids;
        Boolean allowed;
        System.runAs(admin) {
            allowed = FcSelectionService.canRunSoql();
            ids = FcSelectionService.runQuery('select id from FcJob__c where Status__c = \'Acme\'');
        }
        Assert.areEqual(true, allowed);
        Assert.areEqual(new List<Id>{ a.Id }, ids);
    }

    @IsTest
    static void refusesToRunForAUserWithoutThePermission() {
        User plain;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            plain = FcTestData.userWithPermissionSet('FileCrate_User');
        }
        System.runAs(plain) {
            Assert.areEqual(false, FcSelectionService.canRunSoql());
            assertRejected('SELECT Id FROM FcJob__c');
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
