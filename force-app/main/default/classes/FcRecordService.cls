/**
 * Record names for folders and the manifest, plus the object and list view
 * pickers. Everything runs with sharing and in user mode.
 */
public with sharing class FcRecordService {
    /** Object API name to name field. Tests set this; otherwise it is read from FcObjectConfig__mdt. */
    @TestVisible
    private static Map<String, String> nameFieldOverrides;

    /** Names for the records the running user can see. Records they cannot see are left out. */
    public static Map<Id, String> getNames(List<Id> ids) {
        Map<Id, String> names = new Map<Id, String>();
        Map<Schema.SObjectType, Set<Id>> byType = new Map<Schema.SObjectType, Set<Id>>();
        for (Id recordId : ids) {
            if (recordId == null) {
                continue;
            }
            Schema.SObjectType t = recordId.getSobjectType();
            if (!byType.containsKey(t)) {
                byType.put(t, new Set<Id>());
            }
            byType.get(t).add(recordId);
        }
        for (Schema.SObjectType t : byType.keySet()) {
            Schema.DescribeSObjectResult d = t.getDescribe();
            String field = nameFieldFor(d);
            List<SObject> records = queryNames(d.getName(), field, byType.get(t));
            if (records == null && field != 'Id') {
                // The name field is not readable for this user; fall back to the Id.
                field = 'Id';
                records = queryNames(d.getName(), field, byType.get(t));
            }
            if (records == null) {
                continue;
            }
            for (SObject record : records) {
                Object value = field == 'Id' ? null : record.get(field);
                names.put(record.Id, value == null || String.isBlank(String.valueOf(value)) ? String.valueOf(record.Id) : String.valueOf(value));
            }
        }
        return names;
    }

    private static List<SObject> queryNames(String objectName, String field, Set<Id> ids) {
        try {
            return Database.queryWithBinds(
                'SELECT Id' + (field == 'Id' ? '' : ', ' + field) + ' FROM ' + objectName + ' WHERE Id IN :ids',
                new Map<String, Object>{ 'ids' => ids },
                AccessLevel.USER_MODE
            );
        } catch (QueryException e) {
            return null;
        }
    }

    private static String nameFieldFor(Schema.DescribeSObjectResult d) {
        Map<String, Schema.SObjectField> fields = d.fields.getMap();
        String configured = overrides().get(d.getName().toLowerCase());
        if (configured != null && fields.containsKey(configured.toLowerCase())) {
            // Use the describe's own spelling so nothing from configuration reaches the query text.
            return fields.get(configured.toLowerCase()).getDescribe().getName();
        }
        for (Schema.SObjectField f : fields.values()) {
            Schema.DescribeFieldResult fd = f.getDescribe();
            if (fd.isNameField()) {
                return fd.getName();
            }
        }
        return 'Id';
    }

    private static Map<String, String> overrides() {
        Map<String, String> result = new Map<String, String>();
        if (nameFieldOverrides != null) {
            for (String key : nameFieldOverrides.keySet()) {
                result.put(key.toLowerCase(), nameFieldOverrides.get(key));
            }
            return result;
        }
        for (FcObjectConfig__mdt config : FcObjectConfig__mdt.getAll().values()) {
            if (config.Enabled__c && String.isNotBlank(config.ObjectApiName__c) && String.isNotBlank(config.NameField__c)) {
                result.put(config.ObjectApiName__c.toLowerCase(), config.NameField__c);
            }
        }
        return result;
    }

    /**
     * Objects offered in the FileCrate tab: every object that has a tab in some
     * app, plus custom objects. Setup objects such as ApexClass are left out.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getObjects() {
        Set<String> withTab = new Set<String>();
        for (Schema.DescribeTabSetResult app : Schema.describeTabs()) {
            for (Schema.DescribeTabResult tab : app.getTabs()) {
                if (String.isNotBlank(tab.getSobjectName())) {
                    withTab.add(tab.getSobjectName());
                }
            }
        }
        List<Map<String, String>> objects = new List<Map<String, String>>();
        for (Schema.SObjectType t : Schema.getGlobalDescribe().values()) {
            Schema.DescribeSObjectResult d = t.getDescribe(SObjectDescribeOptions.DEFERRED);
            Boolean offered = withTab.contains(d.getName()) || (d.isCustom() && d.getName().endsWith('__c'));
            if (offered && d.isAccessible() && d.isQueryable() && !d.isCustomSetting()) {
                objects.add(new Map<String, String>{ 'value' => d.getName(), 'label' => d.getLabel() });
            }
        }
        objects.sort(new ByLabel());
        return objects;
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getListViews(String objectApiName) {
        List<Map<String, String>> views = new List<Map<String, String>>();
        for (ListView v : [SELECT Id, Name FROM ListView WHERE SobjectType = :objectApiName WITH USER_MODE ORDER BY Name]) {
            views.add(new Map<String, String>{ 'value' => v.Id, 'label' => v.Name });
        }
        return views;
    }

    private class ByLabel implements Comparator<Map<String, String>> {
        public Integer compare(Map<String, String> a, Map<String, String> b) {
            return a.get('label').toLowerCase().compareTo(b.get('label').toLowerCase());
        }
    }
}
