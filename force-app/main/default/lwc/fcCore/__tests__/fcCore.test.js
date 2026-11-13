import {
    sanitizeSegment,
    applyPattern,
    folderFor,
    uniquePath,
    filterRows,
    planParts,
    csvEscape,
    toCsv,
    manifestCsv,
    errorsCsv,
    isStored,
    formatBytes,
    zipName,
    chunk,
    engineOriginFor
} from 'c/fcCore';

describe('sanitizeSegment', () => {
    it('replaces characters that are illegal in file names', () => {
        expect(sanitizeSegment('a/b:c*?"<>|.. ')).toBe('a_b_c______');
    });
    it('replaces backslashes and control characters', () => {
        expect(sanitizeSegment('a\\b\u0001c\n')).toBe('a_b_c_');
    });
    it('returns an underscore for names made only of dots', () => {
        expect(sanitizeSegment('...')).toBe('_');
    });
    it('returns an underscore for empty or missing names', () => {
        expect(sanitizeSegment('')).toBe('_');
        expect(sanitizeSegment(null)).toBe('_');
    });
    it('cuts names to 150 characters', () => {
        expect(sanitizeSegment('x'.repeat(400))).toHaveLength(150);
    });
    it('keeps unicode letters', () => {
        expect(sanitizeSegment('Résumé 日本')).toBe('Résumé 日本');
    });
});

describe('applyPattern', () => {
    const row = {
        id: '068A',
        parentId: '001A',
        parentName: 'Acme',
        parentObject: 'Account',
        title: 'MSA',
        ext: 'pdf',
        createdDate: '2026-03-04T10:00:00.000Z',
        version: '1',
        isLatest: true
    };
    it('fills record name, title and extension', () => {
        expect(applyPattern('{RecordName}_{Title}.{ext}', row)).toBe('Acme_MSA.pdf');
    });
    it('fills the other tokens', () => {
        expect(applyPattern('{Object}-{RecordId}-{FileId}-{CreatedDate}-{Version}.{ext}', row)).toBe(
            'Account-001A-068A-2026-03-04-1.pdf'
        );
    });
    it('drops the trailing dot when there is no extension', () => {
        expect(applyPattern('{Title}.{ext}', { title: 'x', ext: '', isLatest: true })).toBe('x');
    });
    it('adds a version suffix to older versions', () => {
        expect(applyPattern('{Title}.{ext}', { title: 'x', ext: 'pdf', isLatest: false, version: '2' })).toBe(
            'x_v2.pdf'
        );
    });
    it('sanitizes slashes that come from field values', () => {
        expect(applyPattern('{RecordName}_{Title}.{ext}', { ...row, parentName: 'A/B', title: 'c:d' })).toBe(
            'A_B_c_d.pdf'
        );
    });
    it('falls back to the default pattern when the pattern is blank', () => {
        expect(applyPattern('', row)).toBe('Acme_MSA.pdf');
    });
});

describe('folderFor', () => {
    const row = { parentName: 'Acme/West', parentObject: 'Account' };
    it('is empty for the flat layout', () => {
        expect(folderFor('Flat', row)).toBe('');
    });
    it('is the record name for the per-record layout', () => {
        expect(folderFor('PerRecord', row)).toBe('Acme_West');
    });
    it('is object then record for the per-object layout', () => {
        expect(folderFor('PerObject', row)).toBe('Account/Acme_West');
    });
});

describe('uniquePath', () => {
    it('numbers duplicate names without regard to case', () => {
        const used = new Set();
        expect(uniquePath('A/x.pdf', used)).toBe('A/x.pdf');
        expect(uniquePath('a/X.pdf', used)).toBe('a/X (2).pdf');
        expect(uniquePath('A/x.pdf', used)).toBe('A/x (3).pdf');
    });
    it('numbers names that have no extension', () => {
        const used = new Set();
        uniquePath('readme', used);
        expect(uniquePath('readme', used)).toBe('readme (2)');
    });
    it('does not treat a dot in a folder name as an extension', () => {
        const used = new Set();
        uniquePath('v1.2/readme', used);
        expect(uniquePath('v1.2/readme', used)).toBe('v1.2/readme (2)');
    });
});

describe('filterRows', () => {
    const rows = [
        { kind: 'File', ext: 'pdf', size: 100, createdDate: '2026-02-01T00:00:00.000Z' },
        { kind: 'File', ext: 'PNG', size: 5000, createdDate: '2026-06-01T00:00:00.000Z' },
        { kind: 'Attachment', ext: 'txt', size: 10, createdDate: '2025-12-31T23:00:00.000Z' },
        { kind: 'Note', ext: 'txt', size: 10, createdDate: '2026-03-01T00:00:00.000Z' },
        { kind: 'EnhancedNote', ext: 'html', size: 10, createdDate: '2026-03-01T00:00:00.000Z' }
    ];
    const all = {
        includeFiles: true,
        includeAttachments: true,
        includeNotes: true,
        includeEnhancedNotes: true,
        extensions: [],
        createdFrom: null,
        createdTo: null,
        maxSizeBytes: 0
    };
    it('keeps everything with no filters', () => {
        expect(filterRows(rows, all)).toHaveLength(5);
    });
    it('drops kinds that are switched off', () => {
        expect(filterRows(rows, { ...all, includeAttachments: false, includeNotes: false })).toHaveLength(3);
        expect(filterRows(rows, { ...all, includeFiles: false, includeEnhancedNotes: false })).toHaveLength(2);
    });
    it('matches extensions without regard to case', () => {
        expect(filterRows(rows, { ...all, extensions: ['png'] })).toEqual([rows[1]]);
    });
    it('applies an inclusive date range', () => {
        expect(filterRows(rows, { ...all, createdFrom: '2026-02-01', createdTo: '2026-03-01' })).toEqual([
            rows[0],
            rows[3],
            rows[4]
        ]);
    });
    it('drops files over the size cap', () => {
        expect(filterRows(rows, { ...all, maxSizeBytes: 1000 })).toHaveLength(4);
    });
});

describe('planParts', () => {
    it('splits by size and sets oversized files aside', () => {
        expect(planParts([{ size: 6 }, { size: 6 }, { size: 20 }], { maxZipBytes: 10, maxFilesPerZip: 500 })).toEqual({
            parts: [[{ size: 6 }], [{ size: 6 }]],
            oversized: [{ size: 20 }]
        });
    });
    it('splits by file count', () => {
        const rows = [{ size: 1 }, { size: 1 }, { size: 1 }];
        expect(planParts(rows, { maxZipBytes: 100, maxFilesPerZip: 2 }).parts.map((p) => p.length)).toEqual([2, 1]);
    });
    it('returns no parts for no rows', () => {
        expect(planParts([], { maxZipBytes: 10, maxFilesPerZip: 2 })).toEqual({ parts: [], oversized: [] });
    });
});

describe('csv', () => {
    it('quotes cells with commas, quotes and newlines', () => {
        expect(csvEscape('a,"b"\n')).toBe('"a,""b""\n"');
    });
    it('neutralises cells that a spreadsheet would run as a formula', () => {
        expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
        expect(csvEscape('+1')).toBe("'+1");
        expect(csvEscape('-1')).toBe("'-1");
        expect(csvEscape('@x')).toBe("'@x");
    });
    it('neutralises formula cells hidden behind leading whitespace', () => {
        expect(csvEscape('\t=1+1')).toBe("'\t=1+1");
        expect(csvEscape('  @x')).toBe("'  @x");
        expect(csvEscape('\r=1')).toBe('"\'\r=1"');
    });
    it('writes empty text for null and keeps numbers', () => {
        expect(csvEscape(null)).toBe('');
        expect(csvEscape(42)).toBe('42');
    });
    it('builds a file with a byte order mark and CRLF line ends', () => {
        expect(toCsv(['A', 'B'], [['1', 'x,y']])).toBe('﻿A,B\r\n1,"x,y"\r\n');
    });
    it('builds the manifest with its fixed columns', () => {
        const csv = manifestCsv([
            {
                row: {
                    parentId: '001A',
                    parentName: 'Acme',
                    parentObject: 'Account',
                    id: '068A',
                    kind: 'File',
                    size: 12,
                    createdDate: '2026-03-04T10:00:00.000Z'
                },
                fileName: 'Acme_MSA.pdf',
                zipPath: 'Acme/Acme_MSA.pdf',
                link: ''
            }
        ]);
        expect(csv).toBe(
            '﻿Record Id,Record Name,Object,File Id,File Name,Type,Size (bytes),Created Date,Zip Path,Link\r\n' +
                '001A,Acme,Account,068A,Acme_MSA.pdf,File,12,2026-03-04T10:00:00.000Z,Acme/Acme_MSA.pdf,\r\n'
        );
    });
    it('builds the errors file with its fixed columns', () => {
        const csv = errorsCsv([
            { row: { parentId: '001A', parentName: 'Acme', id: '068A' }, fileName: 'x.pdf', reason: 'HTTP 404' }
        ]);
        expect(csv).toBe('﻿Record Id,Record Name,File Id,File Name,Reason\r\n001A,Acme,068A,x.pdf,HTTP 404\r\n');
    });
});

describe('small helpers', () => {
    it('knows which types are already compressed', () => {
        expect(isStored('PDF')).toBe(true);
        expect(isStored('jpeg')).toBe(true);
        expect(isStored('txt')).toBe(false);
        expect(isStored('')).toBe(false);
    });
    it('formats byte counts', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(1572864)).toBe('1.5 MB');
        expect(formatBytes(2040109466)).toBe('1.9 GB');
    });
    it('names a single zip and numbered parts', () => {
        expect(zipName('Account', '2026-11-13', 0, 1)).toBe('crate-Account-2026-11-13.zip');
        expect(zipName('Account', '2026-11-13', 0, 2)).toBe('crate-Account-2026-11-13-part1.zip');
        expect(zipName('My/Obj', '2026-11-13', 1, 2)).toBe('crate-My_Obj-2026-11-13-part2.zip');
    });
    it('chunks arrays', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunk([], 2)).toEqual([]);
    });
});

describe('engineOriginFor', () => {
    it('maps a production Lightning host to the org Visualforce origin', () => {
        expect(engineOriginFor('acme.lightning.force.com')).toBe('https://acme--c.vf.force.com');
    });
    it('maps sandbox and scratch hosts', () => {
        expect(engineOriginFor('acme--uat.sandbox.lightning.force.com')).toBe('https://acme--uat--c.sandbox.vf.force.com');
        expect(engineOriginFor('x-dev-ed.scratch.lightning.force.com')).toBe('https://x-dev-ed--c.scratch.vf.force.com');
    });
    it('is the page origin itself when the page already runs on the Visualforce domain', () => {
        expect(engineOriginFor('acme--c.vf.force.com')).toBe('https://acme--c.vf.force.com');
    });
    it('is null for any other host', () => {
        expect(engineOriginFor('evil.example')).toBeNull();
        expect(engineOriginFor('lightning.force.com.evil.example')).toBeNull();
    });
});
