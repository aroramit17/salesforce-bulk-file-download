@IsTest
public class FcTestData {
    /**
     * A record to hang files on. Tests use FileCrate's own object, not Account or
     * Case, so they pass in orgs that have validation rules or required fields on
     * standard objects. The given name is stored in Status__c and used as the
     * record's display name for the rest of the test.
     */
    public static FcJob__c record(String name) {
        FcRecordService.nameFieldOverrides = new Map<String, String>{ 'FcJob__c' => 'Status__c' };
        FcJob__c r = new FcJob__c(Status__c = name);
        insert r;
        return r;
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

    /**
     * Creates an Enhanced Note on the record. The ContentNote type only exists in
     * orgs where Enhanced Notes are switched on, so it is looked up at run time;
     * returns false when the org does not have it.
     */
    public static Boolean enhancedNote(Id parentId, String title, String html) {
        Schema.SObjectType noteType = Schema.getGlobalDescribe().get('ContentNote');
        if (noteType == null || !noteType.getDescribe().isCreateable()) {
            return false;
        }
        SObject note = noteType.newSObject();
        note.put('Title', title);
        note.put('Content', Blob.valueOf(html));
        insert note;
        link(note.Id, parentId);
        return true;
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

    public static User standardUser() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        String unique = 'fcstd' + Crypto.getRandomInteger() + '@filecrate.test';
        User u = new User(
            ProfileId = p.Id, LastName = 'Standard', Alias = 'fcstd', Email = unique, Username = unique,
            TimeZoneSidKey = 'America/Chicago', LocaleSidKey = 'en_US', EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US'
        );
        insert u;
        return u;
    }

    /** A standard user who also holds the named FileCrate permission set. */
    public static User userWithPermissionSet(String permissionSetName) {
        User u = standardUser();
        PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = :permissionSetName LIMIT 1];
        insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
        return u;
    }

    /**
     * The user a test acts as: a standard user who holds FileCrate_Admin, like a
     * real FileCrate user. The person deploying the package may not hold a
     * FileCrate permission set, and without one the job fields are not visible.
     */
    public static User runner() {
        User u;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            u = userWithPermissionSet('FileCrate_Admin');
        }
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
