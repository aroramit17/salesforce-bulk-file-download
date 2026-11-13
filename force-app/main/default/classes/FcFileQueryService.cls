/**
 * Returns metadata for the Files, Attachments and Notes on a set of records.
 * Runs with sharing and in user mode, so a user only ever gets rows for
 * records and files they can already open. File bytes are never read here.
 */
public with sharing class FcFileQueryService {
    public static final Integer MAX_RECORDS = 200;

    @AuraEnabled
    public static List<FcFileRow> getFiles(List<Id> recordIds, Boolean latestOnly) {
        List<FcFileRow> rows = new List<FcFileRow>();
        if (recordIds == null || recordIds.isEmpty()) {
            return rows;
        }
        if (recordIds.size() > MAX_RECORDS) {
            AuraHandledException e = new AuraHandledException('Too many records in one call. Maximum is ' + MAX_RECORDS + '.');
            e.setMessage('Too many records in one call. Maximum is ' + MAX_RECORDS + '.');
            throw e;
        }
        // Only records the user can see get a name, and only those are searched.
        Map<Id, String> names = FcRecordService.getNames(recordIds);
        Set<Id> ids = names.keySet();
        if (ids.isEmpty()) {
            return rows;
        }
        addFiles(rows, ids, names, latestOnly != false);
        addAttachments(rows, ids, names);
        addNotes(rows, ids, names);
        return rows;
    }

    private static void addFiles(List<FcFileRow> rows, Set<Id> ids, Map<Id, String> names, Boolean latestOnly) {
        Map<Id, List<Id>> parentsByDocument = new Map<Id, List<Id>>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId, LinkedEntityId
            FROM ContentDocumentLink
            WHERE LinkedEntityId IN :ids
            WITH USER_MODE
        ]) {
            if (!parentsByDocument.containsKey(link.ContentDocumentId)) {
                parentsByDocument.put(link.ContentDocumentId, new List<Id>());
            }
            parentsByDocument.get(link.ContentDocumentId).add(link.LinkedEntityId);
        }
        if (parentsByDocument.isEmpty()) {
            return;
        }
        Boolean includeOlder = !latestOnly;
        for (ContentVersion cv : [
            SELECT Id, ContentDocumentId, Title, FileExtension, FileType, ContentSize, CreatedDate, VersionNumber, IsLatest
            FROM ContentVersion
            WHERE ContentDocumentId IN :parentsByDocument.keySet() AND (IsLatest = TRUE OR IsLatest != :includeOlder)
            WITH USER_MODE
            ORDER BY ContentDocumentId, VersionNumber
        ]) {
            Boolean isNote = cv.FileType == 'SNOTE';
            String ext = isNote ? 'html' : (cv.FileExtension == null ? '' : cv.FileExtension);
            for (Id parentId : parentsByDocument.get(cv.ContentDocumentId)) {
                FcFileRow row = baseRow(cv.Id, isNote ? 'EnhancedNote' : 'File', parentId, names, cv.CreatedDate);
                row.title = stripExtension(cv.Title, ext);
                row.ext = ext;
                row.size = cv.ContentSize == null ? 0 : cv.ContentSize;
                row.version = cv.VersionNumber;
                row.isLatest = cv.IsLatest;
                row.path = 'sobjects/ContentVersion/' + cv.Id + '/VersionData';
                rows.add(row);
            }
        }
    }

    private static void addAttachments(List<FcFileRow> rows, Set<Id> ids, Map<Id, String> names) {
        for (Attachment att : [
            SELECT Id, ParentId, Name, BodyLength, CreatedDate
            FROM Attachment
            WHERE ParentId IN :ids
            WITH USER_MODE
        ]) {
            FcFileRow row = baseRow(att.Id, 'Attachment', att.ParentId, names, att.CreatedDate);
            Integer dot = att.Name.lastIndexOf('.');
            row.title = dot > 0 ? att.Name.substring(0, dot) : att.Name;
            row.ext = dot > 0 ? att.Name.substring(dot + 1) : '';
            row.size = att.BodyLength == null ? 0 : att.BodyLength;
            row.path = 'sobjects/Attachment/' + att.Id + '/Body';
            rows.add(row);
        }
    }

    private static void addNotes(List<FcFileRow> rows, Set<Id> ids, Map<Id, String> names) {
        // The body is not queried, so a note's size is reported as 0.
        for (Note n : [SELECT Id, ParentId, Title, CreatedDate FROM Note WHERE ParentId IN :ids WITH USER_MODE]) {
            FcFileRow row = baseRow(n.Id, 'Note', n.ParentId, names, n.CreatedDate);
            row.title = n.Title;
            row.ext = 'txt';
            row.size = 0;
            row.path = 'sobjects/Note/' + n.Id;
            rows.add(row);
        }
    }

    private static FcFileRow baseRow(Id fileId, String kind, Id parentId, Map<Id, String> names, Datetime created) {
        FcFileRow row = new FcFileRow();
        row.id = fileId;
        row.kind = kind;
        row.parentId = parentId;
        row.parentObject = parentId.getSobjectType().getDescribe().getName();
        row.parentName = names.get(parentId);
        row.createdDate = created.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'');
        row.isLatest = true;
        return row;
    }

    private static String stripExtension(String title, String ext) {
        if (title == null) {
            return '';
        }
        if (String.isNotBlank(ext) && title.toLowerCase().endsWith('.' + ext.toLowerCase()) && title.length() > ext.length() + 1) {
            return title.substring(0, title.length() - ext.length() - 1);
        }
        return title;
    }
}
