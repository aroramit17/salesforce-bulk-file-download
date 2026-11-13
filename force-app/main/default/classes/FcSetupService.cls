/** What the admin setup page shows: settings, storage use and what this user may do. */
public with sharing class FcSetupService {
    @AuraEnabled
    public static Map<String, Object> getStatus() {
        Map<String, System.OrgLimit> limits = OrgLimits.getMap();
        return new Map<String, Object>{
            'settings' => FcSettingsService.getSettings(),
            'fileStorage' => storage(limits.get('FileStorageMB')),
            'dataStorage' => storage(limits.get('DataStorageMB')),
            'canRunSoql' => FcSelectionService.canRunSoql(),
            'canReadEventLogs' => Schema.sObjectType.EventLogFile.isAccessible(),
            'apiVersion' => new FcEngineController().getApiVersion()
        };
    }

    private static Map<String, Object> storage(System.OrgLimit orgLimit) {
        return new Map<String, Object>{
            'usedMb' => orgLimit == null ? null : orgLimit.getValue(),
            'maxMb' => orgLimit == null ? null : orgLimit.getLimit()
        };
    }
}
