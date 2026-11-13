/** Reads FcSettings__mdt "Default" and fills any blank with the built-in default. */
public with sharing class FcSettingsService {
    // Zip parts stay under 4 GB and 65,535 entries because the engine writes classic zips.
    private static final Integer MAX_ZIP_MB = 3500;
    private static final Integer MAX_FILES = 60000;

    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getSettings() {
        return fromRecord(FcSettings__mdt.getInstance('Default'));
    }

    @TestVisible
    private static Map<String, Object> fromRecord(FcSettings__mdt r) {
        Boolean has = r != null;
        return new Map<String, Object>{
            'maxFilesPerZip' => clamp(has ? r.MaxFilesPerZip__c : null, 500, MAX_FILES),
            'maxZipMb' => clamp(has ? r.MaxZipMB__c : null, 1500, MAX_ZIP_MB),
            'includeAttachments' => has ? r.IncludeAttachments__c != false : true,
            'includeNotes' => has ? r.IncludeNotes__c != false : true,
            'latestVersionOnly' => has ? r.LatestVersionOnly__c != false : true,
            'namePattern' => has && String.isNotBlank(r.NamePattern__c) ? r.NamePattern__c : '{RecordName}_{Title}.{ext}',
            'folderLayout' => has && String.isNotBlank(r.FolderLayout__c) ? r.FolderLayout__c : 'PerRecord'
        };
    }

    private static Integer clamp(Decimal value, Integer fallback, Integer max) {
        if (value == null || value < 1) {
            return fallback;
        }
        return Math.min(value.intValue(), max);
    }
}
