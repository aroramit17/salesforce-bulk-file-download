@IsTest
private class FcFileQueryServiceTest {
    @IsTest
    static void returnsARowForAFile() {
        Account a = FcTestData.account('Acme');
        ContentVersion cv = FcTestData.file(a.Id, 'MSA.pdf', 'MSA.pdf', 'hello');

        List<FcFileRow> rows = FcFileQueryService.getFiles(new List<Id>{ a.Id }, true);

        FcFileRow row = FcTestData.only(rows, 'File');
        Assert.areEqual(cv.Id, row.id);
        Assert.areEqual('MSA', row.title, 'The extension is stripped from the title');
        Assert.areEqual('pdf', row.ext);
        Assert.areEqual(5, row.size);
        Assert.areEqual(true, row.isLatest);
        Assert.areEqual('1', row.version);
        Assert.areEqual(String.valueOf(a.Id), row.parentId);
        Assert.areEqual('Account', row.parentObject);
        Assert.areEqual('Acme', row.parentName);
        Assert.areEqual('sobjects/ContentVersion/' + cv.Id + '/VersionData', row.path);
        Assert.isTrue(row.createdDate.startsWith(String.valueOf(Date.today().year())), row.createdDate);
    }

    @IsTest
    static void keepsATitleThatHasNoExtensionInIt() {
        Account a = FcTestData.account('Acme');
        FcTestData.file(a.Id, 'Quarterly report', 'q.docx', 'x');
        FcFileRow row = FcTestData.only(FcFileQueryService.getFiles(new List<Id>{ a.Id }, true), 'File');
        Assert.areEqual('Quarterly report', row.title);
        Assert.areEqual('docx', row.ext);
    }

    @IsTest
    static void returnsARowForAnAttachment() {
        Account a = FcTestData.account('Acme');
        Attachment att = FcTestData.attachment(a.Id, 'scan.v2.png', 'abc');

        FcFileRow row = FcTestData.only(FcFileQueryService.getFiles(new List<Id>{ a.Id }, true), 'Attachment');

        Assert.areEqual(att.Id, row.id);
        Assert.areEqual('scan.v2', row.title);
        Assert.areEqual('png', row.ext);
        Assert.areEqual(3, row.size);
        Assert.areEqual('sobjects/Attachment/' + att.Id + '/Body', row.path);
        Assert.areEqual('Acme', row.parentName);
    }

    @IsTest
    static void returnsARowForAnAttachmentWithNoExtension() {
        Account a = FcTestData.account('Acme');
        FcTestData.attachment(a.Id, 'README', 'abc');
        FcFileRow row = FcTestData.only(FcFileQueryService.getFiles(new List<Id>{ a.Id }, true), 'Attachment');
        Assert.areEqual('README', row.title);
        Assert.areEqual('', row.ext);
    }

    @IsTest
    static void returnsARowForAClassicNote() {
        Account a = FcTestData.account('Acme');
        Note n = FcTestData.note(a.Id, 'Call', 'spoke to them');

        FcFileRow row = FcTestData.only(FcFileQueryService.getFiles(new List<Id>{ a.Id }, true), 'Note');

        Assert.areEqual(n.Id, row.id);
        Assert.areEqual('Call', row.title);
        Assert.areEqual('txt', row.ext);
        Assert.areEqual('sobjects/Note/' + n.Id, row.path);
    }

    @IsTest
    static void returnsARowForAnEnhancedNote() {
        Account a = FcTestData.account('Acme');
        FcTestData.enhancedNote(a.Id, 'Kickoff', '<p>hi</p>');

        FcFileRow row = FcTestData.only(FcFileQueryService.getFiles(new List<Id>{ a.Id }, true), 'EnhancedNote');

        Assert.areEqual('Kickoff', row.title);
        Assert.areEqual('html', row.ext);
        Assert.isTrue(row.path.startsWith('sobjects/ContentVersion/'), row.path);
    }

    @IsTest
    static void returnsOnlyTheLatestVersionByDefault() {
        Account a = FcTestData.account('Acme');
        ContentVersion v1 = FcTestData.file(a.Id, 'Plan', 'Plan.txt', 'one');
        ContentVersion v2 = FcTestData.newVersion(v1.ContentDocumentId, 'Plan.txt', 'two!');

        List<FcFileRow> rows = FcFileQueryService.getFiles(new List<Id>{ a.Id }, true);

        Assert.areEqual(1, rows.size());
        Assert.areEqual(v2.Id, rows[0].id);
    }

    @IsTest
    static void returnsEveryVersionWhenAsked() {
        Account a = FcTestData.account('Acme');
        ContentVersion v1 = FcTestData.file(a.Id, 'Plan', 'Plan.txt', 'one');
        FcTestData.newVersion(v1.ContentDocumentId, 'Plan.txt', 'two!');

        List<FcFileRow> rows = FcFileQueryService.getFiles(new List<Id>{ a.Id }, false);

        Assert.areEqual(2, rows.size());
        Integer latest = 0;
        for (FcFileRow r : rows) {
            if (r.isLatest) {
                latest++;
                Assert.areEqual('2', r.version);
            } else {
                Assert.areEqual(v1.Id, r.id);
                Assert.areEqual('1', r.version);
            }
        }
        Assert.areEqual(1, latest);
    }

    @IsTest
    static void returnsOneRowPerRecordForASharedFile() {
        Account a = FcTestData.account('Acme');
        Account b = FcTestData.account('Globex');
        ContentVersion cv = FcTestData.file(a.Id, 'Shared', 'Shared.pdf', 'x');
        FcTestData.link(cv.ContentDocumentId, b.Id);

        List<FcFileRow> rows = FcFileQueryService.getFiles(new List<Id>{ a.Id, b.Id }, true);

        Assert.areEqual(2, rows.size());
        Set<String> parents = new Set<String>{ rows[0].parentName, rows[1].parentName };
        Assert.areEqual(new Set<String>{ 'Acme', 'Globex' }, parents);
    }

    @IsTest
    static void returnsNothingForNoRecords() {
        Assert.areEqual(0, FcFileQueryService.getFiles(new List<Id>(), true).size());
        Assert.areEqual(0, FcFileQueryService.getFiles(null, true).size());
    }

    @IsTest
    static void rejectsMoreThan200Records() {
        Account a = FcTestData.account('Acme');
        List<Id> ids = new List<Id>();
        for (Integer i = 0; i < 201; i++) {
            ids.add(a.Id);
        }
        try {
            FcFileQueryService.getFiles(ids, true);
            Assert.fail('Expected an exception');
        } catch (AuraHandledException e) {
            Assert.isTrue(true);
        }
    }

    @IsTest
    static void returnsNothingToAUserWhoCannotSeeTheRecord() {
        Account a = FcTestData.account('Acme');
        FcTestData.file(a.Id, 'Secret', 'Secret.pdf', 'x');
        FcTestData.attachment(a.Id, 'secret.txt', 'x');
        FcTestData.note(a.Id, 'Secret', 'x');
        User u = FcTestData.userWithoutRecordAccess();

        List<FcFileRow> rows;
        System.runAs(u) {
            rows = FcFileQueryService.getFiles(new List<Id>{ a.Id }, true);
        }

        Assert.areEqual(0, rows.size());
    }
}
