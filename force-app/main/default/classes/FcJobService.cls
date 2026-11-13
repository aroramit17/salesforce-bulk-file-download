/**
 * Job history: one FcJob__c row per finished run. Sharing is private, so a
 * user sees their own jobs; FileCrate_Admin grants View All.
 */
public with sharing class FcJobService {
    @AuraEnabled
    public static Id logJob(Map<String, Object> job) {
        FcJob__c record = new FcJob__c(
            Status__c = text(job, 'status', 40),
            SourceType__c = text(job, 'sourceType', 40),
            ObjectApiName__c = text(job, 'objectApiName', 80),
            Destination__c = text(job, 'destination', 40),
            DestinationPath__c = text(job, 'destinationPath', 255),
            RecordCount__c = numberOf(job, 'recordCount'),
            FileCount__c = numberOf(job, 'fileCount'),
            TotalBytes__c = numberOf(job, 'totalBytes'),
            Query__c = text(job, 'request', 131072),
            Error__c = text(job, 'error', 32768)
        );
        Database.insert(record, AccessLevel.USER_MODE);
        return record.Id;
    }

    @AuraEnabled
    public static List<Map<String, Object>> getJobs() {
        List<Map<String, Object>> jobs = new List<Map<String, Object>>();
        for (FcJob__c j : [
            SELECT Id, Name, Status__c, SourceType__c, ObjectApiName__c, Destination__c, RecordCount__c, FileCount__c,
                TotalBytes__c, Query__c, Error__c, CreatedDate, CreatedBy.Name
            FROM FcJob__c
            WITH USER_MODE
            ORDER BY CreatedDate DESC, Name DESC
            LIMIT 50
        ]) {
            jobs.add(new Map<String, Object>{
                'id' => j.Id, 'name' => j.Name, 'status' => j.Status__c, 'sourceType' => j.SourceType__c,
                'objectApiName' => j.ObjectApiName__c, 'destination' => j.Destination__c,
                'recordCount' => j.RecordCount__c, 'fileCount' => j.FileCount__c, 'totalBytes' => j.TotalBytes__c,
                'request' => j.Query__c, 'error' => j.Error__c, 'createdDate' => j.CreatedDate,
                'createdByName' => j.CreatedBy.Name
            });
        }
        return jobs;
    }

    private static String text(Map<String, Object> job, String key, Integer max) {
        Object value = job == null ? null : job.get(key);
        if (value == null) {
            return null;
        }
        String s = String.valueOf(value);
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static Decimal numberOf(Map<String, Object> job, String key) {
        Object value = job == null ? null : job.get(key);
        if (value == null) {
            return null;
        }
        try {
            return Decimal.valueOf(String.valueOf(value));
        } catch (TypeException e) {
            return null;
        }
    }
}
