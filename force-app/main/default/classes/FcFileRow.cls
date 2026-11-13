/**
 * One downloadable item: a file version, attachment or note on a selected record.
 * Holds metadata only. File bytes are never read in Apex.
 */
public with sharing class FcFileRow {
    @AuraEnabled public String id;
    @AuraEnabled public String kind;
    @AuraEnabled public String parentId;
    @AuraEnabled public String parentObject;
    @AuraEnabled public String parentName;
    @AuraEnabled public String title;
    @AuraEnabled public String ext;
    @AuraEnabled public Long size;
    @AuraEnabled public String createdDate;
    @AuraEnabled public String version;
    @AuraEnabled public Boolean isLatest;
    @AuraEnabled public String path;
}
