// Seeds sample data for manual checks: sf apex run -f scripts/seed.apex
Account a = new Account(Name = 'Harbor Freight Lines');
Account b = new Account(Name = 'Northwind Dental / Group');
insert new List<Account>{ a, b };

List<ContentVersion> files = new List<ContentVersion>();
for (Integer i = 1; i <= 20; i++) {
    files.add(new ContentVersion(Title = 'Small ' + i, PathOnClient = 'small-' + i + '.txt',
        VersionData = Blob.valueOf('file ' + i + ' ' + 'x'.repeat(2000)), FirstPublishLocationId = a.Id));
}
// Two files with the same title on one record.
files.add(new ContentVersion(Title = 'Same name.pdf', PathOnClient = 'same.pdf', VersionData = Blob.valueOf('first'), FirstPublishLocationId = a.Id));
files.add(new ContentVersion(Title = 'Same name.pdf', PathOnClient = 'same.pdf', VersionData = Blob.valueOf('second'), FirstPublishLocationId = a.Id));
files.add(new ContentVersion(Title = 'Plan', PathOnClient = 'plan.txt', VersionData = Blob.valueOf('plan v1'), FirstPublishLocationId = a.Id));
for (Integer i = 1; i <= 3; i++) {
    files.add(new ContentVersion(Title = 'Dental: doc ' + i, PathOnClient = 'doc' + i + '.csv',
        VersionData = Blob.valueOf('a,b\n1,2\n'), FirstPublishLocationId = b.Id));
}
insert files;

ContentVersion plan = [SELECT ContentDocumentId FROM ContentVersion WHERE Title = 'Plan' AND FirstPublishLocationId = :a.Id LIMIT 1];
insert new ContentVersion(ContentDocumentId = plan.ContentDocumentId, PathOnClient = 'plan.txt', VersionData = Blob.valueOf('plan v2'));

insert new Attachment(ParentId = a.Id, Name = 'classic scan.txt', Body = Blob.valueOf('classic attachment body'));
insert new Note(ParentId = a.Id, Title = 'Call note', Body = 'Spoke to procurement. Renewal looks likely.');
ContentNote cn = new ContentNote(Title = 'Kickoff notes', Content = Blob.valueOf('<p>Kickoff went well.</p>'));
insert cn;
insert new ContentDocumentLink(ContentDocumentId = cn.Id, LinkedEntityId = a.Id, ShareType = 'V');
System.debug('SEEDED ' + a.Id + ',' + b.Id);
