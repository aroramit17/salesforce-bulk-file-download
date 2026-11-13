/**
 * Ways to pick records beyond a list view: related records of one record,
 * a name search, and (for users with the Fc_Run_SOQL custom permission) a
 * SELECT Id query. Everything runs with sharing and in user mode, and only
 * record Ids ever leave this class.
 */
public with sharing class FcSelectionService {
    // Caps. Tests lower them; every cap is reported when it is hit, never applied silently.
    @TestVisible private static Integer maxRelated = 2000;
    @TestVisible private static Integer maxSearch = 200;
    @TestVisible private static Integer maxQuery = 10000;

    // ---- related records ----------------------------------------------------

    /**
     * paths are child relationship names, one or two levels deep, for example
     * "Opportunities" or "Opportunities.OpportunityLineItems". Returns
     * { byPath: path -> Ids at the end of that path, errors: messages }.
     */
    @AuraEnabled
    public static Map<String, Object> getRelatedIds(Id recordId, List<String> paths) {
        Map<String, List<Id>> byPath = new Map<String, List<Id>>();
        List<String> errors = new List<String>();
        for (String raw : paths == null ? new List<String>() : paths) {
            String path = raw == null ? '' : raw.trim();
            if (path == '') {
                continue;
            }
            List<String> segments = path.split('\\.');
            if (segments.size() > 2) {
                errors.add(String.format(System.Label.Fc_Err_Levels, new List<Object>{ path }));
                continue;
            }
            List<Id> current = new List<Id>{ recordId };
            Schema.SObjectType currentType = recordId.getSobjectType();
            Boolean ok = true;
            for (String segment : segments) {
                Schema.ChildRelationship rel = findRelationship(currentType, segment.trim());
                if (rel == null) {
                    errors.add(String.format(System.Label.Fc_Err_No_Relationship, new List<Object>{ path, segment.trim(), currentType.getDescribe().getName() }));
                    ok = false;
                    break;
                }
                try {
                    current = childIds(rel, current);
                    if (current.size() > maxRelated) {
                        while (current.size() > maxRelated) {
                            current.remove(current.size() - 1);
                        }
                        errors.add(String.format(System.Label.Fc_Err_Related_Cap, new List<Object>{ path, String.valueOf(maxRelated) }));
                    }
                } catch (QueryException e) {
                    errors.add(path + ': ' + e.getMessage());
                    ok = false;
                    break;
                }
                currentType = rel.getChildSObject();
            }
            if (ok) {
                byPath.put(path, current);
            }
        }
        return new Map<String, Object>{ 'byPath' => byPath, 'errors' => errors };
    }

    private static Schema.ChildRelationship findRelationship(Schema.SObjectType parentType, String name) {
        for (Schema.ChildRelationship rel : parentType.getDescribe().getChildRelationships()) {
            if (rel.getRelationshipName() != null && rel.getRelationshipName().equalsIgnoreCase(name)) {
                return rel;
            }
        }
        return null;
    }

    private static List<Id> childIds(Schema.ChildRelationship rel, List<Id> parentIds) {
        List<Id> ids = new List<Id>();
        if (parentIds.isEmpty()) {
            return ids;
        }
        // Object and field names come from describe, never from the caller.
        String soql =
            'SELECT Id FROM ' + rel.getChildSObject().getDescribe().getName() +
            ' WHERE ' + rel.getField().getDescribe().getName() + ' IN :parentIds LIMIT ' + (maxRelated + 1);
        for (SObject record : Database.queryWithBinds(soql, new Map<String, Object>{ 'parentIds' => parentIds }, AccessLevel.USER_MODE)) {
            ids.add(record.Id);
        }
        return ids;
    }

    // ---- search -------------------------------------------------------------

    @AuraEnabled
    public static Map<String, Object> searchRecords(String objectApiName, String term) {
        Schema.SObjectType objectType = objectApiName == null ? null : Schema.getGlobalDescribe().get(objectApiName);
        if (objectType == null || !objectType.getDescribe().isAccessible()) {
            throw auraError(String.format(System.Label.Fc_Err_Unknown_Object, new List<Object>{ objectApiName }));
        }
        List<Map<String, String>> found = new List<Map<String, String>>();
        String searchText = searchTextFor(term);
        Map<String, Object> result = new Map<String, Object>{ 'records' => found, 'truncated' => false };
        if (searchText == null) {
            return result;
        }
        String sosl =
            'FIND \'' + searchText + '\' IN NAME FIELDS RETURNING ' +
            objectType.getDescribe().getName() + '(Id LIMIT ' + (maxSearch + 1) + ')';
        List<Id> ids = new List<Id>();
        for (SObject record : Search.query(sosl, AccessLevel.USER_MODE)[0]) {
            ids.add(record.Id);
        }
        if (ids.size() > maxSearch) {
            ids.remove(ids.size() - 1);
            result.put('truncated', true);
        }
        Map<Id, String> names = FcRecordService.getNames(ids);
        for (Id recordId : ids) {
            if (names.containsKey(recordId)) {
                found.add(new Map<String, String>{ 'id' => recordId, 'name' => names.get(recordId) });
            }
        }
        return result;
    }

    /**
     * Turns what the user typed into prefix-matched words joined by AND. Only
     * letters and digits survive, so nothing typed can act as SOSL syntax.
     */
    @TestVisible
    private static String searchTextFor(String term) {
        if (term == null) {
            return null;
        }
        List<String> words = new List<String>();
        for (String word : term.replaceAll('[^\\p{L}\\p{N}]+', ' ').trim().split('\\s+')) {
            String lower = word.toLowerCase();
            if (word.length() >= 2 && lower != 'and' && lower != 'or' && lower != 'not') {
                words.add(word + '*');
            }
        }
        return words.isEmpty() ? null : String.join(words, ' AND ');
    }

    // ---- SOQL mode ----------------------------------------------------------

    @AuraEnabled(cacheable=true)
    public static Boolean canRunSoql() {
        return FeatureManagement.checkPermission('Fc_Run_SOQL');
    }

    @AuraEnabled
    public static List<Id> runQuery(String soql) {
        if (!canRunSoql()) {
            throw auraError(System.Label.Fc_Err_Soql_Permission);
        }
        // A semicolon inside a quoted value is fine; one outside it would start a second statement.
        if (String.isBlank(soql) || soql.replaceAll('\'(\\\\.|[^\'\\\\])*\'', '').contains(';')) {
            throw auraError(System.Label.Fc_Err_Soql_Form);
        }
        Matcher m = Pattern.compile('(?is)^\\s*select\\s+id\\s+from\\s+([a-z0-9_]+)\\b.*$').matcher(soql);
        if (!m.matches()) {
            throw auraError(System.Label.Fc_Err_Soql_Select);
        }
        if (!Schema.getGlobalDescribe().containsKey(m.group(1).toLowerCase())) {
            throw auraError(String.format(System.Label.Fc_Err_Unknown_Object, new List<Object>{ m.group(1) }));
        }
        Matcher limitMatcher = Pattern.compile('(?is)\\blimit\\s+(\\d+)\\s*(offset\\s+\\d+\\s*)?$').matcher(soql.trim());
        if (limitMatcher.find() && (limitMatcher.group(1).length() > 9 || Integer.valueOf(limitMatcher.group(1)) > maxQuery)) {
            throw auraError(String.format(System.Label.Fc_Err_Soql_Limit, new List<Object>{ String.valueOf(maxQuery) }));
        }
        List<Id> ids = new List<Id>();
        try {
            // The query text is the user's own, run with their own access.
            for (SObject record : Database.query(withLimit(soql), AccessLevel.USER_MODE)) {
                ids.add(record.Id);
            }
        } catch (QueryException e) {
            throw auraError(e.getMessage());
        }
        if (ids.size() > maxQuery) {
            throw auraError(String.format(System.Label.Fc_Err_Soql_Too_Many, new List<Object>{ String.valueOf(maxQuery) }));
        }
        return ids;
    }

    @TestVisible
    private static String withLimit(String soql) {
        String trimmed = soql.trim();
        Boolean hasLimit = Pattern.compile('(?is)\\blimit\\s+\\d+\\s*(offset\\s+\\d+\\s*)?$').matcher(trimmed).find();
        // One more than the cap, so a query that matches too much can be told apart from one that fits.
        return hasLimit ? trimmed : trimmed + ' LIMIT ' + (maxQuery + 1);
    }

    private static AuraHandledException auraError(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }
}
