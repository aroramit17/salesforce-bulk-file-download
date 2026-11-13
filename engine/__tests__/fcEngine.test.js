import * as core from 'c/fcCore';

const fflate = require('fflate');
const fs = require('fs');
const path = require('path');
const { createEngine, createParentLink } = require('../fcEngine');

const API = '/services/data/v66.0/';

function concat(chunks) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    chunks.forEach((c) => {
        out.set(c, at);
        at += c.length;
    });
    return out;
}

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        arrayBuffer: async () => (body instanceof Uint8Array ? body.buffer.slice(0) : new ArrayBuffer(0)),
        json: async () => body
    };
}

// routes: { [url]: Uint8Array | object | number (status) | function }
function fakeFetch(routes) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, init });
        const route = routes[url];
        if (route === undefined) {
            return response(404, null);
        }
        if (typeof route === 'function') {
            return route(calls.filter((c) => c.url === url).length);
        }
        if (typeof route === 'number') {
            return response(route, null);
        }
        return response(200, route);
    };
    fn.calls = calls;
    return fn;
}

function fileRow(id, parentName, title, ext, bytes, extra) {
    return {
        id,
        kind: 'File',
        parentId: '001' + parentName,
        parentObject: 'Account',
        parentName,
        title,
        ext,
        size: bytes.length,
        createdDate: '2026-03-04T10:00:00.000Z',
        version: '1',
        isLatest: true,
        path: 'sobjects/ContentVersion/' + id + '/VersionData',
        ...extra
    };
}

const OPTIONS = {
    layout: 'PerRecord',
    pattern: '{RecordName}_{Title}.{ext}',
    maxZipBytes: 1000000,
    maxFilesPerZip: 500
};

function setup(routes, options) {
    const posts = [];
    const fetchFn = fakeFetch(routes);
    const engine = createEngine({
        fflate,
        core,
        fetchFn,
        post: (m) => posts.push(m),
        apiBase: API,
        sessionId: 'SESSION',
        baseUrl: 'https://example.my.salesforce.com',
        now: () => new Date(2026, 10, 13),
        makeBlob: concat,
        retryDelayMs: 0,
        nonce: 'n1'
    });
    const run = async (rows) => {
        await engine.handle({ fc: 1, type: 'start', jobId: 'j1', options: { ...OPTIONS, ...options }, objectLabel: 'Account' });
        await engine.handle({ fc: 1, type: 'rows', jobId: 'j1', rows, last: true });
    };
    const parts = () => posts.filter((m) => m.type === 'part');
    const unzip = (i) => {
        const files = fflate.unzipSync(parts()[i].blob);
        const out = {};
        Object.keys(files).forEach((k) => {
            out[k] = fflate.strFromU8(files[k]);
        });
        return out;
    };
    return { engine, posts, fetchFn, run, parts, unzip, last: (type) => posts.filter((m) => m.type === type).pop() };
}

const A = fflate.strToU8('alpha');
const B = fflate.strToU8('bravo bravo');
const C = fflate.strToU8('charlie');

describe('zip building', () => {
    it('zips files from two records into per-record folders with a manifest', async () => {
        const rows = [
            fileRow('068A', 'Acme', 'MSA', 'pdf', A),
            fileRow('068B', 'Acme', 'Notes', 'txt', B),
            fileRow('068C', 'Globex', 'Logo', 'png', C)
        ];
        const t = setup({
            [API + rows[0].path]: A,
            [API + rows[1].path]: B,
            [API + rows[2].path]: C
        });
        await t.run(rows);

        expect(t.parts()).toHaveLength(1);
        expect(t.parts()[0].name).toBe('crate-Account-2026-11-13.zip');
        const files = t.unzip(0);
        expect(files['Acme/Acme_MSA.pdf']).toBe('alpha');
        expect(files['Acme/Acme_Notes.txt']).toBe('bravo bravo');
        expect(files['Globex/Globex_Logo.png']).toBe('charlie');
        expect(files['manifest.csv']).toContain('001Acme,Acme,Account,068A,Acme_MSA.pdf,File,5,');
        expect(files['manifest.csv']).toContain('Globex/Globex_Logo.png');
        expect(files['errors.csv']).toBeUndefined();
        expect(t.last('done')).toMatchObject({ jobId: 'j1', ok: 3, failed: 0, oversized: 0, cancelled: false });
    });

    it('sends the session as a bearer token', async () => {
        const rows = [fileRow('068A', 'Acme', 'MSA', 'pdf', A)];
        const t = setup({ [API + rows[0].path]: A });
        await t.run(rows);
        expect(t.fetchFn.calls[0].init.headers.Authorization).toBe('Bearer SESSION');
    });

    it('keeps both of two files that share a name', async () => {
        const rows = [fileRow('068A', 'Acme', 'x', 'pdf', A), fileRow('068B', 'Acme', 'x', 'pdf', B)];
        const t = setup({ [API + rows[0].path]: A, [API + rows[1].path]: B });
        await t.run(rows);
        const files = t.unzip(0);
        expect(files['Acme/Acme_x.pdf']).toBe('alpha');
        expect(files['Acme/Acme_x (2).pdf']).toBe('bravo bravo');
    });

    it('writes a classic Note body as text', async () => {
        const note = {
            ...fileRow('002N', 'Acme', 'Call', 'txt', A),
            kind: 'Note',
            path: 'sobjects/Note/002N'
        };
        const t = setup({ [API + 'sobjects/Note/002N']: { Id: '002N', Body: 'called them — ok' } });
        await t.run([note]);
        expect(t.unzip(0)['Acme/Acme_Call.txt']).toBe('called them — ok');
    });

    it('splits into numbered parts, each with its own manifest', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A), fileRow('068B', 'Acme', 'b', 'txt', B)];
        const t = setup({ [API + rows[0].path]: A, [API + rows[1].path]: B }, { maxZipBytes: 12 });
        await t.run(rows);
        expect(t.parts().map((p) => p.name)).toEqual([
            'crate-Account-2026-11-13-part1.zip',
            'crate-Account-2026-11-13-part2.zip'
        ]);
        expect(t.parts()[0]).toMatchObject({ index: 0, count: 2 });
        expect(Object.keys(t.unzip(0)).sort()).toEqual(['Acme/Acme_a.txt', 'manifest.csv']);
        expect(Object.keys(t.unzip(1)).sort()).toEqual(['Acme/Acme_b.txt', 'manifest.csv']);
    });

    it('lists an oversized file in the manifest with a link and never fetches it', async () => {
        const big = fileRow('068BIG', 'Acme', 'video', 'mp4', new Uint8Array(50));
        const small = fileRow('068A', 'Acme', 'a', 'txt', A);
        const t = setup({ [API + small.path]: A }, { maxZipBytes: 20 });
        await t.run([big, small]);
        const manifest = t.unzip(0)['manifest.csv'];
        expect(manifest).toContain('068BIG,Acme_video.mp4,File,50,2026-03-04T10:00:00.000Z,,https://example.my.salesforce.com/068BIG');
        expect(t.fetchFn.calls.map((c) => c.url)).toEqual([API + small.path]);
        expect(t.last('done')).toMatchObject({ ok: 1, oversized: 1 });
    });

    it('reports progress after each file', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A), fileRow('068B', 'Acme', 'b', 'txt', B)];
        const t = setup({ [API + rows[0].path]: A, [API + rows[1].path]: B });
        await t.run(rows);
        const progress = t.posts.filter((m) => m.type === 'progress');
        expect(progress[progress.length - 1]).toMatchObject({ done: 2, total: 2, bytes: 16, totalBytes: 16 });
    });

    it('finishes with nothing to save when there are no rows', async () => {
        const t = setup({});
        await t.run([]);
        expect(t.parts()).toHaveLength(0);
        expect(t.last('done')).toMatchObject({ ok: 0, failed: 0 });
    });
});

describe('failures', () => {
    it('lists a file that cannot be fetched in errors.csv and still delivers the rest', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A), fileRow('068GONE', 'Acme', 'gone', 'txt', B)];
        const t = setup({ [API + rows[0].path]: A });
        await t.run(rows);
        const files = t.unzip(0);
        expect(files['Acme/Acme_a.txt']).toBe('alpha');
        expect(files['Acme/Acme_gone.txt']).toBeUndefined();
        expect(files['errors.csv']).toContain('001Acme,Acme,068GONE,Acme_gone.txt,HTTP 404');
        expect(t.last('done')).toMatchObject({ ok: 1, failed: 1 });
    });

    it('stops with an auth error on 401 and saves nothing', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A)];
        const t = setup({ [API + rows[0].path]: 401 });
        await t.run(rows);
        expect(t.parts()).toHaveLength(0);
        expect(t.last('fatal')).toMatchObject({ jobId: 'j1', code: 'AUTH' });
        expect(t.last('done')).toBeUndefined();
    });

    it('treats 403 as an auth error too', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A)];
        const t = setup({ [API + rows[0].path]: 403 });
        await t.run(rows);
        expect(t.last('fatal')).toMatchObject({ code: 'AUTH' });
    });

    it('retries a server error twice before giving up', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A)];
        const t = setup({ [API + rows[0].path]: (n) => (n < 3 ? response(503, null) : response(200, A)) });
        await t.run(rows);
        expect(t.fetchFn.calls).toHaveLength(3);
        expect(t.unzip(0)['Acme/Acme_a.txt']).toBe('alpha');
    });

    it('records a file as failed after three server errors', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A)];
        const t = setup({ [API + rows[0].path]: 500 });
        await t.run(rows);
        expect(t.fetchFn.calls).toHaveLength(3);
        expect(t.unzip(0)['errors.csv']).toContain('HTTP 500');
    });

    it('retries when the network call throws', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A)];
        const t = setup({
            [API + rows[0].path]: (n) => {
                if (n === 1) {
                    throw new TypeError('Failed to fetch');
                }
                return response(200, A);
            }
        });
        await t.run(rows);
        expect(t.unzip(0)['Acme/Acme_a.txt']).toBe('alpha');
    });
});

describe('message identity', () => {
    it('stamps every message with the nonce of its builder', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A)];
        const t = setup({ [API + rows[0].path]: A });
        await t.run(rows);
        expect(t.posts.length).toBeGreaterThan(2);
        t.posts.forEach((m) => expect(m.nonce).toBe('n1'));
    });
});

describe('failures across parts', () => {
    it('lists each failure in the part where it happened', async () => {
        const rows = [fileRow('068GONE', 'Acme', 'gone', 'txt', A), fileRow('068B', 'Acme', 'b', 'txt', B)];
        const t = setup({ [API + rows[1].path]: B }, { maxFilesPerZip: 1 });
        await t.run(rows);
        expect(t.parts()).toHaveLength(2);
        expect(t.unzip(0)['errors.csv']).toContain('068GONE');
        expect(t.unzip(1)['errors.csv']).toBeUndefined();
    });

    it('has already recorded earlier failures when a later part hits an auth error', async () => {
        const rows = [fileRow('068GONE', 'Acme', 'gone', 'txt', A), fileRow('068B', 'Acme', 'b', 'txt', B)];
        const t = setup({ [API + rows[1].path]: 401 }, { maxFilesPerZip: 1 });
        await t.run(rows);
        expect(t.parts()).toHaveLength(1);
        expect(t.unzip(0)['errors.csv']).toContain('068GONE');
        expect(t.last('fatal')).toMatchObject({ code: 'AUTH' });
    });
});

describe('cancel', () => {
    it('stops after the current file and saves nothing', async () => {
        const rows = [fileRow('068A', 'Acme', 'a', 'txt', A), fileRow('068B', 'Acme', 'b', 'txt', B)];
        let engine;
        const t = setup({
            [API + rows[0].path]: () => {
                engine.handle({ fc: 1, type: 'cancel', jobId: 'j1' });
                return response(200, A);
            },
            [API + rows[1].path]: B
        });
        engine = t.engine;
        await t.run(rows);
        expect(t.parts()).toHaveLength(0);
        expect(t.last('done')).toMatchObject({ cancelled: true });
    });
});

describe('list view ids', () => {
    it('reads the list view query and pages through every record', async () => {
        const q1 = API + 'query?q=' + encodeURIComponent("SELECT Id FROM Account WHERE Industry = 'Banking' ORDER BY Name ASC");
        const t = setup({
            [API + 'sobjects/Account/listviews/00B1/describe']: {
                query: "SELECT Name, Owner.Alias, Id FROM Account WHERE Industry = 'Banking' ORDER BY Name ASC"
            },
            [q1]: { done: false, nextRecordsUrl: '/services/data/v66.0/query/01g-2000', records: [{ Id: '001A' }, { Id: '001B' }] },
            '/services/data/v66.0/query/01g-2000': { done: true, records: [{ Id: '001C' }] }
        });
        await t.engine.handle({ fc: 1, type: 'listview', requestId: 'r7', object: 'Account', listViewId: '00B1' });
        expect(t.last('ids')).toEqual({ fc: 1, nonce: 'n1', type: 'ids', requestId: 'r7', ids: ['001A', '001B', '001C'] });
    });

    it('reports an error when the list view cannot be read', async () => {
        const t = setup({});
        await t.engine.handle({ fc: 1, type: 'listview', object: 'Account', listViewId: '00B1' });
        expect(t.last('ids').error).toBe('HTTP 404');
        expect(t.last('ids').ids).toEqual([]);
    });

    it('reports an auth error when the API is not available', async () => {
        const t = setup({ [API + 'sobjects/Account/listviews/00B1/describe']: 401 });
        await t.engine.handle({ fc: 1, type: 'listview', object: 'Account', listViewId: '00B1' });
        expect(t.last('fatal')).toMatchObject({ code: 'AUTH' });
    });
});

describe('parent link', () => {
    const LIGHTNING = 'https://acme.lightning.force.com';
    const VF = 'https://acme--c.vf.force.com';

    it('announces to every allowed origin', () => {
        const sent = [];
        createParentLink([LIGHTNING, VF], (m, o) => sent.push([m.type, o])).announce({ fc: 1, type: 'ready' });
        expect(sent).toEqual([['ready', LIGHTNING], ['ready', VF]]);
    });

    it('rejects messages from an origin that is not allowed', () => {
        const link = createParentLink([LIGHTNING, VF], () => {});
        expect(link.accept('https://evil.example')).toBe(false);
        expect(link.accept(LIGHTNING)).toBe(true);
    });

    it('replies only to the allowed origin that spoke', () => {
        const sent = [];
        const link = createParentLink([LIGHTNING, VF], (m, o) => sent.push(o));
        link.post({ fc: 1, type: 'progress' });
        expect(sent).toEqual([]);
        link.accept('https://evil.example');
        link.post({ fc: 1, type: 'progress' });
        expect(sent).toEqual([]);
        link.accept(VF);
        link.post({ fc: 1, type: 'progress' });
        expect(sent).toEqual([VF]);
    });
});

describe('bundle', () => {
    it('is up to date with fcCore and fcEngine', () => {
        const { buildBundle } = require('../../scripts/build-bundle');
        const committed = fs.readFileSync(
            path.join(__dirname, '../../force-app/main/default/staticresources/fcEngineBundle.js'),
            'utf8'
        );
        expect(committed).toBe(buildBundle());
    });

    it('exposes FcCore and FcEngine as globals', () => {
        const { buildBundle } = require('../../scripts/build-bundle');
        const scope = {};
        // eslint-disable-next-line no-new-func
        new Function('window', 'self', buildBundle())(scope, scope);
        expect(typeof scope.FcCore.planParts).toBe('function');
        expect(typeof scope.FcEngine.createEngine).toBe('function');
    });
});
