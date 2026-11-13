@IsTest
private class FcJobServiceTest {
    private static Map<String, Object> sample() {
        return new Map<String, Object>{
            'status' => 'Done', 'sourceType' => 'ListView', 'objectApiName' => 'Account', 'destination' => 'Browser',
            'recordCount' => 3, 'fileCount' => 29, 'totalBytes' => 52468000, 'request' => '{"mode":"listviews"}', 'error' => null
        };
    }

    @IsTest
    static void savesAJob() {
        System.runAs(FcTestData.runner()) {
            Id jobId = FcJobService.logJob(sample());
            FcJob__c job = [SELECT Name, Status__c, SourceType__c, ObjectApiName__c, Destination__c, RecordCount__c, FileCount__c, TotalBytes__c, Query__c FROM FcJob__c WHERE Id = :jobId];
            Assert.isTrue(job.Name.startsWith('FC-'), job.Name);
            Assert.areEqual('Done', job.Status__c);
            Assert.areEqual('ListView', job.SourceType__c);
            Assert.areEqual('Account', job.ObjectApiName__c);
            Assert.areEqual('Browser', job.Destination__c);
            Assert.areEqual(3, job.RecordCount__c);
            Assert.areEqual(29, job.FileCount__c);
            Assert.areEqual(52468000, job.TotalBytes__c);
            Assert.areEqual('{"mode":"listviews"}', job.Query__c);
        }
    }

    @IsTest
    static void cutsTextThatIsTooLong() {
        System.runAs(FcTestData.runner()) {
            Map<String, Object> job = sample();
            job.put('status', 'x'.repeat(100));
            job.put('error', 'e'.repeat(40000));
            Id jobId = FcJobService.logJob(job);
            FcJob__c saved = [SELECT Status__c, Error__c FROM FcJob__c WHERE Id = :jobId];
            Assert.areEqual(40, saved.Status__c.length());
            Assert.areEqual(32768, saved.Error__c.length());
        }
    }

    @IsTest
    static void listsJobsNewestFirst() {
        System.runAs(FcTestData.runner()) {
            FcJobService.logJob(sample());
            Map<String, Object> second = sample();
            second.put('status', 'Partial');
            FcJobService.logJob(second);

            List<Map<String, Object>> jobs = FcJobService.getJobs();

            Assert.areEqual(2, jobs.size());
            Map<String, Object> job = jobs[0];
            for (String key : new List<String>{ 'id', 'name', 'status', 'sourceType', 'objectApiName', 'destination', 'recordCount', 'fileCount', 'totalBytes', 'request', 'createdDate', 'createdByName' }) {
                Assert.isTrue(job.containsKey(key), key);
            }
        }
    }

    @IsTest
    static void aUserSeesOnlyTheirOwnJobs() {
        User other;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            other = FcTestData.userWithPermissionSet('FileCrate_User');
        }
        System.runAs(FcTestData.runner()) {
            FcJobService.logJob(sample());
        }
        System.runAs(other) {
            Assert.areEqual(0, FcJobService.getJobs().size());
            FcJobService.logJob(sample());
            Assert.areEqual(1, FcJobService.getJobs().size());
        }
    }

    @IsTest
    static void anAdminSeesEveryJob() {
        User other;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            other = FcTestData.userWithPermissionSet('FileCrate_User');
        }
        System.runAs(other) {
            FcJobService.logJob(sample());
        }
        System.runAs(FcTestData.runner()) {
            Assert.areEqual(1, FcJobService.getJobs().size(), 'FileCrate_Admin grants View All');
        }
    }
}
