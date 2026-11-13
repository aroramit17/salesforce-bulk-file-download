@IsTest
private class FcOrgFileServiceTest {
    @IsTest
    static void returnsDocumentsFromAFolder() {
        Document d = new Document(Name = 'Price list.pdf', Type = 'pdf', Body = Blob.valueOf('abcd'), FolderId = UserInfo.getUserId());
        insert d;

        List<FcFileRow> rows = FcOrgFileService.getDocuments(UserInfo.getUserId());

        FcFileRow row = FcTestData.only(rows, 'Document');
        Assert.areEqual(d.Id, row.id);
        Assert.areEqual('Price list', row.title);
        Assert.areEqual('pdf', row.ext);
        Assert.areEqual(4, row.size);
        Assert.areEqual('sobjects/Document/' + d.Id + '/Body', row.path);
        Assert.areEqual('Document', row.parentObject);
        Assert.isTrue(String.isNotBlank(row.parentName));
    }

    @IsTest
    static void returnsEveryDocumentWhenNoFolderIsGiven() {
        insert new Document(Name = 'One', Type = 'txt', Body = Blob.valueOf('a'), FolderId = UserInfo.getUserId());
        insert new Document(Name = 'Two', Type = 'txt', Body = Blob.valueOf('b'), FolderId = UserInfo.getUserId());
        Assert.areEqual(2, FcOrgFileService.getDocuments(null).size());
    }

    @IsTest
    static void leavesOutLinkDocumentsThatHaveNoBody() {
        insert new Document(Name = 'Link', Url = 'https://example.com/x.pdf', FolderId = UserInfo.getUserId());
        Assert.areEqual(0, FcOrgFileService.getDocuments(UserInfo.getUserId()).size());
    }

    @IsTest
    static void listsDocumentFolders() {
        List<Map<String, String>> folders = FcOrgFileService.getDocumentFolders();
        Assert.isNotNull(folders);
        Assert.areEqual(String.valueOf(UserInfo.getUserId()), folders[0].get('value'), 'The personal folder comes first');
    }

    @IsTest
    static void returnsFilesFromALibrary() {
        ContentWorkspace library = new ContentWorkspace(Name = 'FileCrate Test Library ' + Crypto.getRandomInteger());
        // A library is a setup object, so it is created in its own context.
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert library;
        }
        ContentVersion cv = new ContentVersion(Title = 'Handbook', PathOnClient = 'Handbook.pdf', VersionData = Blob.valueOf('hello'));
        insert cv;
        cv = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id];
        insert new ContentWorkspaceDoc(ContentWorkspaceId = library.Id, ContentDocumentId = cv.ContentDocumentId);

        Boolean listed = false;
        for (Map<String, String> option : FcOrgFileService.getLibraries()) {
            listed = listed || option.get('value') == String.valueOf(library.Id);
        }
        Assert.isTrue(listed, 'The library is offered');

        List<FcFileRow> rows = FcOrgFileService.getLibraryFiles(library.Id);
        FcFileRow row = FcTestData.only(rows, 'File');
        Assert.areEqual(cv.Id, row.id);
        Assert.areEqual('Handbook', row.title);
        Assert.areEqual('pdf', row.ext);
        Assert.areEqual(library.Name, row.parentName);
        Assert.areEqual('Library', row.parentObject);
        Assert.areEqual('sobjects/ContentVersion/' + cv.Id + '/VersionData', row.path);
    }

    @IsTest
    static void returnsStaticResources() {
        Boolean foundBundle = false;
        for (FcFileRow row : FcOrgFileService.getStaticResources()) {
            Assert.areEqual('StaticResource', row.kind);
            Assert.areEqual('Static Resources', row.parentName);
            if (row.title == 'fcEngineBundle') {
                foundBundle = true;
                Assert.areEqual('js', row.ext);
                Assert.areEqual('sobjects/StaticResource/' + row.id + '/Body', row.path);
                Assert.isTrue(row.size > 0);
            }
        }
        Assert.isTrue(foundBundle, 'The engine bundle is a static resource in this org');
    }

    @IsTest
    static void mapsContentTypesToExtensions() {
        Assert.areEqual('zip', FcOrgFileService.extensionFor('application/zip'));
        Assert.areEqual('js', FcOrgFileService.extensionFor('application/javascript'));
        Assert.areEqual('js', FcOrgFileService.extensionFor('text/javascript'));
        Assert.areEqual('css', FcOrgFileService.extensionFor('text/css'));
        Assert.areEqual('png', FcOrgFileService.extensionFor('image/png'));
        Assert.areEqual('svg', FcOrgFileService.extensionFor('image/svg+xml'));
        Assert.areEqual('resource', FcOrgFileService.extensionFor('application/x-something-odd'));
        Assert.areEqual('resource', FcOrgFileService.extensionFor(null));
    }

    @IsTest
    static void buildsAnEventLogRow() {
        Id fakeId = '0ATxx0000000001AAA';
        FcFileRow row = FcOrgFileService.eventLogRow(fakeId, 'Login', Datetime.newInstanceGmt(2026, 11, 12), 2048, 'Daily', 0, Datetime.newInstanceGmt(2026, 11, 13));
        Assert.areEqual('EventLog', row.kind);
        Assert.areEqual('Login_2026-11-12', row.title);
        Assert.areEqual('csv', row.ext);
        Assert.areEqual(2048, row.size);
        Assert.areEqual('Login', row.parentName);
        Assert.areEqual('sobjects/EventLogFile/' + fakeId + '/LogFile', row.path);

        FcFileRow hourly = FcOrgFileService.eventLogRow(fakeId, 'API', Datetime.newInstanceGmt(2026, 11, 12, 5, 0, 0), 10, 'Hourly', 3, Datetime.newInstanceGmt(2026, 11, 13));
        Assert.areEqual('API_2026-11-12_05h_3', hourly.title);
    }

    @IsTest
    static void returnsEventLogsForAnAdmin() {
        Assert.isNotNull(FcOrgFileService.getEventLogFiles(null, Date.today().addDays(-7), Date.today()));
        Assert.isNotNull(FcOrgFileService.getEventLogFiles('Login', null, null));
    }

    @IsTest
    static void explainsWhenTheUserMayNotReadEventLogs() {
        User u;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            u = FcTestData.userWithPermissionSet('FileCrate_User');
        }
        System.runAs(u) {
            try {
                FcOrgFileService.getEventLogFiles(null, null, null);
                Assert.fail('Expected an exception');
            } catch (AuraHandledException e) {
                Assert.isTrue(e.getMessage().contains('View Event Log Files'), e.getMessage());
            }
        }
    }
}
