/**
 * File sources that do not hang off a record: Documents, Library files,
 * Static Resources and Event Log files. Returns metadata rows only; the
 * browser fetches the bytes. Runs with sharing and in user mode.
 */
public with sharing class FcOrgFileService {
    private static final Integer MAX_ROWS = 5000;

    // ---- Documents ----------------------------------------------------------

    @AuraEnabled
    public static List<Map<String, String>> getDocumentFolders() {
        List<Map<String, String>> folders = new List<Map<String, String>>{
            new Map<String, String>{ 'value' => UserInfo.getUserId(), 'label' => System.Label.Fc_Personal_Documents }
        };
        for (Folder f : [SELECT Id, Name FROM Folder WHERE Type = 'Document' WITH USER_MODE ORDER BY Name LIMIT 1000]) {
            folders.add(new Map<String, String>{ 'value' => f.Id, 'label' => f.Name });
        }
        return folders;
    }

    @AuraEnabled
    public static List<FcFileRow> getDocuments(Id folderId) {
        List<Document> documents = folderId == null
            ? [SELECT Id, Name, Type, BodyLength, FolderId, Url, CreatedDate FROM Document WITH USER_MODE ORDER BY Name LIMIT :MAX_ROWS]
            : [SELECT Id, Name, Type, BodyLength, FolderId, Url, CreatedDate FROM Document WHERE FolderId = :folderId WITH USER_MODE ORDER BY Name LIMIT :MAX_ROWS];
        Set<Id> folderIds = new Set<Id>();
        for (Document d : documents) {
            folderIds.add(d.FolderId);
        }
        Map<Id, String> folderNames = new Map<Id, String>();
        for (Folder f : [SELECT Id, Name FROM Folder WHERE Id IN :folderIds WITH USER_MODE]) {
            folderNames.put(f.Id, f.Name);
        }
        List<FcFileRow> rows = new List<FcFileRow>();
        for (Document d : documents) {
            if (String.isNotBlank(d.Url)) {
                continue; // a link to an external file, with no body to download
            }
            String ext = d.Type == null ? '' : d.Type;
            FcFileRow row = row(d.Id, 'Document', d.CreatedDate);
            row.parentId = d.FolderId;
            row.parentObject = 'Document';
            row.parentName = folderNames.containsKey(d.FolderId) ? folderNames.get(d.FolderId) : System.Label.Fc_Personal_Documents;
            row.title = stripExtension(d.Name, ext);
            row.ext = ext;
            row.size = d.BodyLength == null ? 0 : d.BodyLength;
            row.path = 'sobjects/Document/' + d.Id + '/Body';
            rows.add(row);
        }
        return rows;
    }

    // ---- Libraries ----------------------------------------------------------

    @AuraEnabled
    public static List<Map<String, String>> getLibraries() {
        List<Map<String, String>> libraries = new List<Map<String, String>>();
        for (ContentWorkspace w : [SELECT Id, Name FROM ContentWorkspace WITH USER_MODE ORDER BY Name LIMIT 1000]) {
            libraries.add(new Map<String, String>{ 'value' => w.Id, 'label' => w.Name });
        }
        return libraries;
    }

    @AuraEnabled
    public static List<FcFileRow> getLibraryFiles(Id libraryId) {
        List<FcFileRow> rows = new List<FcFileRow>();
        List<ContentWorkspace> library = [SELECT Id, Name FROM ContentWorkspace WHERE Id = :libraryId WITH USER_MODE];
        if (library.isEmpty()) {
            return rows;
        }
        for (ContentVersion cv : [
            SELECT Id, Title, FileExtension, ContentSize, CreatedDate, VersionNumber
            FROM ContentVersion
            WHERE IsLatest = TRUE AND ContentDocument.ParentId = :libraryId
            WITH USER_MODE
            ORDER BY Title
            LIMIT :MAX_ROWS
        ]) {
            String ext = cv.FileExtension == null ? '' : cv.FileExtension;
            FcFileRow row = row(cv.Id, 'File', cv.CreatedDate);
            row.parentId = libraryId;
            row.parentObject = 'Library';
            row.parentName = library[0].Name;
            row.title = stripExtension(cv.Title, ext);
            row.ext = ext;
            row.size = cv.ContentSize == null ? 0 : cv.ContentSize;
            row.version = cv.VersionNumber;
            row.path = 'sobjects/ContentVersion/' + cv.Id + '/VersionData';
            rows.add(row);
        }
        return rows;
    }

    // ---- Static resources ---------------------------------------------------

    @AuraEnabled
    public static List<FcFileRow> getStaticResources() {
        List<FcFileRow> rows = new List<FcFileRow>();
        for (StaticResource r : [
            SELECT Id, Name, NamespacePrefix, ContentType, BodyLength, CreatedDate
            FROM StaticResource
            WITH USER_MODE
            ORDER BY Name
            LIMIT :MAX_ROWS
        ]) {
            FcFileRow row = row(r.Id, 'StaticResource', r.CreatedDate);
            row.parentId = UserInfo.getOrganizationId();
            row.parentObject = 'StaticResource';
            row.parentName = System.Label.Fc_Static_Resources;
            row.title = (String.isBlank(r.NamespacePrefix) ? '' : r.NamespacePrefix + '__') + r.Name;
            row.ext = extensionFor(r.ContentType);
            row.size = r.BodyLength == null ? 0 : r.BodyLength;
            row.path = 'sobjects/StaticResource/' + r.Id + '/Body';
            rows.add(row);
        }
        return rows;
    }

    @TestVisible
    private static String extensionFor(String contentType) {
        Map<String, String> known = new Map<String, String>{
            'application/zip' => 'zip', 'application/x-zip-compressed' => 'zip',
            'application/javascript' => 'js', 'text/javascript' => 'js', 'application/x-javascript' => 'js',
            'text/css' => 'css', 'text/html' => 'html', 'text/plain' => 'txt', 'text/csv' => 'csv',
            'application/json' => 'json', 'application/xml' => 'xml', 'text/xml' => 'xml', 'application/pdf' => 'pdf',
            'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/gif' => 'gif', 'image/svg+xml' => 'svg',
            'image/x-icon' => 'ico', 'font/woff' => 'woff', 'font/woff2' => 'woff2'
        };
        String key = contentType == null ? '' : contentType.toLowerCase().substringBefore(';').trim();
        return known.containsKey(key) ? known.get(key) : 'resource';
    }

    // ---- Event logs ---------------------------------------------------------

    @AuraEnabled
    public static List<FcFileRow> getEventLogFiles(String eventType, Date fromDate, Date toDate) {
        if (!Schema.sObjectType.EventLogFile.isAccessible()) {
            AuraHandledException e = new AuraHandledException(System.Label.Fc_Event_Log_Permission);
            e.setMessage(System.Label.Fc_Event_Log_Permission);
            throw e;
        }
        List<String> conditions = new List<String>();
        Map<String, Object> binds = new Map<String, Object>();
        if (String.isNotBlank(eventType)) {
            conditions.add('EventType = :eventType');
            binds.put('eventType', eventType);
        }
        if (fromDate != null) {
            conditions.add('LogDate >= :fromTime');
            binds.put('fromTime', Datetime.newInstanceGmt(fromDate, Time.newInstance(0, 0, 0, 0)));
        }
        if (toDate != null) {
            conditions.add('LogDate < :toTime');
            binds.put('toTime', Datetime.newInstanceGmt(toDate.addDays(1), Time.newInstance(0, 0, 0, 0)));
        }
        String soql =
            'SELECT Id, EventType, LogDate, LogFileLength, Interval, Sequence, CreatedDate FROM EventLogFile' +
            (conditions.isEmpty() ? '' : ' WHERE ' + String.join(conditions, ' AND ')) +
            ' ORDER BY LogDate DESC, EventType LIMIT ' + MAX_ROWS;
        List<FcFileRow> rows = new List<FcFileRow>();
        for (EventLogFile log : (List<EventLogFile>) Database.queryWithBinds(soql, binds, AccessLevel.USER_MODE)) {
            rows.add(eventLogRow(log.Id, log.EventType, log.LogDate, log.LogFileLength, log.Interval, log.Sequence, log.CreatedDate));
        }
        return rows;
    }

    @TestVisible
    private static FcFileRow eventLogRow(Id logId, String eventType, Datetime logDate, Decimal length, String interval, Decimal sequence, Datetime created) {
        FcFileRow row = row(logId, 'EventLog', created);
        row.parentId = UserInfo.getOrganizationId();
        row.parentObject = 'EventLogFile';
        row.parentName = eventType;
        row.title = eventType + '_' + logDate.formatGmt('yyyy-MM-dd') +
            (interval == 'Hourly' ? '_' + logDate.formatGmt('HH') + 'h_' + (sequence == null ? 0 : sequence.intValue()) : '');
        row.ext = 'csv';
        row.size = length == null ? 0 : length.longValue();
        row.path = 'sobjects/EventLogFile/' + logId + '/LogFile';
        return row;
    }

    // ---- shared -------------------------------------------------------------

    private static FcFileRow row(Id fileId, String kind, Datetime created) {
        FcFileRow row = new FcFileRow();
        row.id = fileId;
        row.kind = kind;
        row.createdDate = created.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
        row.isLatest = true;
        return row;
    }

    private static String stripExtension(String name, String ext) {
        if (name == null) {
            return '';
        }
        if (String.isNotBlank(ext) && name.toLowerCase().endsWith('.' + ext.toLowerCase()) && name.length() > ext.length() + 1) {
            return name.substring(0, name.length() - ext.length() - 1);
        }
        return name;
    }
}
