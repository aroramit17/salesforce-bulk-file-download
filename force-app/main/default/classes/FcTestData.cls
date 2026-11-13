@IsTest
public class FcTestData {
    public static Account account(String name) {
        Account a = new Account(Name = name);
        insert a;
        return a;
    }

    public static ContentVersion file(Id parentId, String title, String pathOnClient, String body) {
        ContentVersion cv = new ContentVersion(
            Title = title,
            PathOnClient = pathOnClient,
            VersionData = Blob.valueOf(body),
            FirstPublishLocationId = parentId
        );
        insert cv;
        return [SELECT Id, ContentDocumentId, ContentSize FROM ContentVersion WHERE Id = :cv.Id];
    }

    public static ContentVersion newVersion(Id contentDocumentId, String pathOnClient, String body) {
        ContentVersion cv = new ContentVersion(
            ContentDocumentId = contentDocumentId,
            PathOnClient = pathOnClient,
            VersionData = Blob.valueOf(body)
        );
        insert cv;
        return cv;
    }

    public static void link(Id contentDocumentId, Id recordId) {
        insert new ContentDocumentLink(ContentDocumentId = contentDocumentId, LinkedEntityId = recordId, ShareType = 'V');
    }

    public static Attachment attachment(Id parentId, String name, String body) {
        Attachment a = new Attachment(ParentId = parentId, Name = name, Body = Blob.valueOf(body));
        insert a;
        return a;
    }

    public static Note note(Id parentId, String title, String body) {
        Note n = new Note(ParentId = parentId, Title = title, Body = body);
        insert n;
        return n;
    }

    public static ContentNote enhancedNote(Id parentId, String title, String html) {
        ContentNote n = new ContentNote(Title = title, Content = Blob.valueOf(html));
        insert n;
        link(n.Id, parentId);
        return n;
    }

    /** A user whose profile grants no access to Account. */
    public static User userWithoutRecordAccess() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
        String unique = 'fc' + Crypto.getRandomInteger() + '@filecrate.test';
        User u = new User(
            ProfileId = p.Id, LastName = 'NoAccess', Alias = 'fcnoacc', Email = unique, Username = unique,
            TimeZoneSidKey = 'America/Chicago', LocaleSidKey = 'en_US', EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US'
        );
        insert u;
        return u;
    }

    public static FcFileRow only(List<FcFileRow> rows, String kind) {
        FcFileRow found;
        for (FcFileRow r : rows) {
            if (r.kind == kind) {
                Assert.isNull(found, 'Expected one ' + kind + ' row');
                found = r;
            }
        }
        Assert.isNotNull(found, 'Expected a ' + kind + ' row');
        return found;
    }
}
