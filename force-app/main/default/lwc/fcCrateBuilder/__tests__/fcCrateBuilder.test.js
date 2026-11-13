import { createElement } from 'lwc';
import FcCrateBuilder from 'c/fcCrateBuilder';
import getFiles from '@salesforce/apex/FcFileQueryService.getFiles';
import getSettings from '@salesforce/apex/FcSettingsService.getSettings';
import getRelatedIds from '@salesforce/apex/FcSelectionService.getRelatedIds';
import logJob from '@salesforce/apex/FcJobService.logJob';

jest.mock('@salesforce/apex/FcFileQueryService.getFiles', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcSettingsService.getSettings', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcSelectionService.getRelatedIds', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcJobService.logJob', () => ({ default: jest.fn() }), { virtual: true });

const SETTINGS = {
    maxFilesPerZip: 500,
    maxZipMb: 1500,
    includeAttachments: true,
    includeNotes: true,
    latestVersionOnly: true,
    namePattern: '{RecordName}_{Title}.{ext}',
    folderLayout: 'PerRecord'
};

function row(id, kind, size, ext) {
    return {
        id,
        kind,
        size,
        ext: ext || 'pdf',
        title: 't' + id,
        parentId: '001A',
        parentObject: 'Account',
        parentName: 'Acme',
        createdDate: '2026-03-04T10:00:00.000Z',
        version: '1',
        isLatest: true,
        path: 'p/' + id
    };
}

const flush = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

async function mount(props) {
    const el = createElement('c-fc-crate-builder', { is: FcCrateBuilder });
    Object.assign(el, props);
    document.body.appendChild(el);
    await flush();
    return el;
}

const q = (el, id) => el.shadowRoot.querySelector('[data-id="' + id + '"]');

function nonceOf(el) {
    return new URL(el.shadowRoot.querySelector('iframe').src, 'https://x.example').searchParams.get('fc');
}

function fromEngine(el, data) {
    const frame = el.shadowRoot.querySelector('iframe');
    window.dispatchEvent(
        new MessageEvent('message', {
            data: { fc: 1, nonce: nonceOf(el), ...data },
            origin: 'https://org--c.vf.force.com',
            source: frame.contentWindow
        })
    );
}

describe('c-fc-crate-builder', () => {
    beforeEach(() => {
        getSettings.mockResolvedValue(SETTINGS);
        getFiles.mockResolvedValue([row('1', 'File', 1048576), row('2', 'File', 524288), row('3', 'Attachment', 1024)]);
        getRelatedIds.mockResolvedValue({ byPath: {}, errors: [] });
        logJob.mockResolvedValue('a00');
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('shows the file count and total size for the selected records', async () => {
        const el = await mount({ recordIds: ['001A'] });
        expect(getFiles).toHaveBeenCalledWith({ recordIds: ['001A'], latestOnly: true });
        expect(q(el, 'count').textContent).toBe('3');
        expect(q(el, 'size').textContent).toBe('1.5 MB');
    });

    it('asks for records in chunks of 200', async () => {
        const ids = Array.from({ length: 450 }, (_, i) => 'id' + i);
        await mount({ recordIds: ids });
        expect(getFiles.mock.calls.map((c) => c[0].recordIds.length)).toEqual([200, 200, 50]);
    });

    it('says so and disables Download when nothing matches', async () => {
        getFiles.mockResolvedValue([]);
        const el = await mount({ recordIds: ['001A'] });
        fromEngine(el, { type: 'ready' });
        await flush();
        expect(q(el, 'no-files')).not.toBeNull();
        expect(q(el, 'download').disabled).toBe(true);
    });

    it('keeps Download disabled until the engine is ready', async () => {
        const el = await mount({ recordIds: ['001A'] });
        expect(q(el, 'download').disabled).toBe(true);
        fromEngine(el, { type: 'ready' });
        await flush();
        expect(q(el, 'download').disabled).toBe(false);
    });

    it('updates the preview without another server call when a kind is unticked', async () => {
        const el = await mount({ recordIds: ['001A'] });
        const box = el.shadowRoot.querySelector('[data-option="includeAttachments"]');
        box.checked = false;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(q(el, 'count').textContent).toBe('2');
        expect(getFiles).toHaveBeenCalledTimes(1);
    });

    it('asks the server again when "latest version only" is switched off', async () => {
        const el = await mount({ recordIds: ['001A'] });
        const box = el.shadowRoot.querySelector('[data-option="latestOnly"]');
        box.checked = false;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(getFiles).toHaveBeenLastCalledWith({ recordIds: ['001A'], latestOnly: false });
    });

    it('ignores messages that do not come from its own engine frame', async () => {
        const el = await mount({ recordIds: ['001A'] });
        window.dispatchEvent(new MessageEvent('message', { data: { fc: 1, type: 'ready' }, origin: 'https://evil.example', source: window }));
        await flush();
        expect(q(el, 'download').disabled).toBe(true);
    });

    it('sends the options and the rows to the engine when Download is clicked', async () => {
        const el = await mount({ recordIds: ['001A'], objectApiName: 'Account' });
        const frame = el.shadowRoot.querySelector('iframe');
        const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
        fromEngine(el, { type: 'ready' });
        await flush();
        q(el, 'download').click();
        await flush();

        const sent = post.mock.calls.map((c) => c[0]);
        expect(post.mock.calls[0][1]).toBe('https://org--c.vf.force.com');
        expect(sent[0]).toMatchObject({
            fc: 1,
            type: 'start',
            objectLabel: 'Account',
            options: { layout: 'PerRecord', pattern: '{RecordName}_{Title}.{ext}', maxZipBytes: 1500 * 1024 * 1024, maxFilesPerZip: 500 }
        });
        expect(sent[1]).toMatchObject({ type: 'rows', jobId: sent[0].jobId, last: true });
        expect(sent[1].rows.map((r) => r.id)).toEqual(['1', '2', '3']);
        expect(q(el, 'progress')).not.toBeNull();
    });

    it('shows the API access message when the engine reports an auth failure', async () => {
        const el = await mount({ recordIds: ['001A'] });
        fromEngine(el, { type: 'ready' });
        fromEngine(el, { type: 'fatal', jobId: null, code: 'AUTH', message: 'HTTP 401' });
        await flush();
        expect(q(el, 'error').textContent).toBe('c.Fc_Auth_Error');
    });

    it('shows a message when the server call fails', async () => {
        getFiles.mockRejectedValue({ body: { message: 'boom' } });
        const el = await mount({ recordIds: ['001A'] });
        expect(q(el, 'error').textContent).toContain('boom');
    });

    it('says no records are selected when it is given none', async () => {
        const el = await mount({ recordIds: [] });
        expect(q(el, 'no-records')).not.toBeNull();
        expect(getFiles).not.toHaveBeenCalled();
    });

    it('asks the engine for the record ids of a list view', async () => {
        const el = await mount({ listViewId: '00B1', objectApiName: 'Account' });
        const frame = el.shadowRoot.querySelector('iframe');
        const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
        fromEngine(el, { type: 'ready' });
        await flush();
        const request = post.mock.calls[0][0];
        expect(request).toMatchObject({ fc: 1, type: 'listview', object: 'Account', listViewId: '00B1' });
        expect(request.requestId).toBeTruthy();
        fromEngine(el, { type: 'ids', requestId: request.requestId, ids: ['001A', '001B'] });
        await flush();
        expect(getFiles).toHaveBeenCalledWith({ recordIds: ['001A', '001B'], latestOnly: true });
        expect(q(el, 'count').textContent).toBe('3');
    });

    it('gives each builder its own nonce in the engine address', async () => {
        const a = await mount({ recordIds: ['001A'] });
        const b = await mount({ recordIds: ['001B'] });
        expect(nonceOf(a)).toMatch(/^[A-Za-z0-9]{16,}$/);
        expect(nonceOf(a)).not.toBe(nonceOf(b));
    });

    it('ignores engine messages that carry another builder nonce', async () => {
        const el = await mount({ recordIds: ['001A'] });
        fromEngine(el, { type: 'ready', nonce: 'someoneelse' });
        await flush();
        expect(q(el, 'download').disabled).toBe(true);
    });

    it('ignores list view ids that answer an older request', async () => {
        const el = await mount({ listViewId: '00B1', objectApiName: 'Account' });
        const frame = el.shadowRoot.querySelector('iframe');
        const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
        fromEngine(el, { type: 'ready' });
        await flush();
        const first = post.mock.calls[0][0].requestId;
        el.listViewId = '00B2';
        await flush();
        const second = post.mock.calls[1][0].requestId;
        expect(second).not.toBe(first);

        fromEngine(el, { type: 'ids', requestId: second, ids: ['001NEW'] });
        await flush();
        fromEngine(el, { type: 'ids', requestId: first, ids: ['001OLD1', '001OLD2'] });
        await flush();

        expect(getFiles).toHaveBeenCalledTimes(1);
        expect(getFiles).toHaveBeenCalledWith({ recordIds: ['001NEW'], latestOnly: true });
    });

    it('gives up with a message when the engine never starts', async () => {
        jest.useFakeTimers();
        try {
            const el = await mount({ listViewId: '00B1', objectApiName: 'Account' });
            jest.advanceTimersByTime(20000);
            await flush();
            expect(q(el, 'error').textContent).toBe('c.Fc_Engine_Error');
        } finally {
            jest.useRealTimers();
        }
    });

    it('does not give up once the engine has started', async () => {
        jest.useFakeTimers();
        try {
            const el = await mount({ recordIds: ['001A'] });
            fromEngine(el, { type: 'ready' });
            jest.advanceTimersByTime(20000);
            await flush();
            expect(q(el, 'error')).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    it('can start over after the settings failed to load', async () => {
        getSettings.mockRejectedValueOnce({ body: { message: 'down' } });
        const el = await mount({ recordIds: ['001A'] });
        expect(q(el, 'error').textContent).toContain('down');
        q(el, 'start-over').click();
        await flush();
        expect(getSettings).toHaveBeenCalledTimes(2);
        expect(q(el, 'count').textContent).toBe('3');
    });

    describe('related records', () => {
        beforeEach(() => {
            getRelatedIds.mockResolvedValue({ byPath: { Contacts: ['003A', '003B'], 'Contacts.Cases': [] }, errors: ['Nope: no relationship named Nope on Account.'] });
        });

        it('offers each configured path with its record count', async () => {
            const el = await mount({ recordIds: ['001A'], relatedPaths: 'Contacts, Contacts.Cases, Nope' });
            expect(getRelatedIds).toHaveBeenCalledWith({ recordId: '001A', paths: ['Contacts', 'Contacts.Cases', 'Nope'] });
            const boxes = el.shadowRoot.querySelectorAll('[data-related]');
            expect(Array.from(boxes).map((b) => b.dataset.related)).toEqual(['Contacts', 'Contacts.Cases']);
            expect(boxes[0].checked).toBe(false);
            expect(q(el, 'related-errors').textContent).toContain('Nope');
        });

        it('adds the related records when a path is ticked and drops them when unticked', async () => {
            const el = await mount({ recordIds: ['001A'], relatedPaths: 'Contacts' });
            const box = el.shadowRoot.querySelector('[data-related="Contacts"]');
            box.checked = true;
            box.dispatchEvent(new CustomEvent('change'));
            await flush();
            expect(getFiles).toHaveBeenLastCalledWith({ recordIds: ['001A', '003A', '003B'], latestOnly: true });
            const again = el.shadowRoot.querySelector('[data-related="Contacts"]');
            again.checked = false;
            again.dispatchEvent(new CustomEvent('change'));
            await flush();
            expect(getFiles).toHaveBeenLastCalledWith({ recordIds: ['001A'], latestOnly: true });
        });

        it('asks for nothing when no paths are configured', async () => {
            await mount({ recordIds: ['001A'] });
            expect(getRelatedIds).not.toHaveBeenCalled();
        });
    });

    describe('several list views', () => {
        it('resolves each list view in turn and merges the record ids', async () => {
            const el = await mount({
                listViews: [
                    { objectApiName: 'Account', listViewId: '00B1' },
                    { objectApiName: 'Case', listViewId: '00B2' }
                ]
            });
            const frame = el.shadowRoot.querySelector('iframe');
            const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
            fromEngine(el, { type: 'ready' });
            await flush();
            expect(post.mock.calls[0][0]).toMatchObject({ type: 'listview', object: 'Account', listViewId: '00B1' });
            fromEngine(el, { type: 'ids', requestId: post.mock.calls[0][0].requestId, ids: ['001A', '001B'] });
            await flush();
            expect(post.mock.calls[1][0]).toMatchObject({ type: 'listview', object: 'Case', listViewId: '00B2' });
            expect(getFiles).not.toHaveBeenCalled();
            fromEngine(el, { type: 'ids', requestId: post.mock.calls[1][0].requestId, ids: ['500A', '001A'] });
            await flush();
            expect(getFiles).toHaveBeenCalledWith({ recordIds: ['001A', '001B', '500A'], latestOnly: true });
        });
    });

    describe('preset rows', () => {
        it('shows rows it was handed without asking the server', async () => {
            const el = await mount({ presetRows: [row('9', 'Document', 2048), row('10', 'StaticResource', 2048)], presetLabel: 'Documents' });
            expect(getFiles).not.toHaveBeenCalled();
            expect(q(el, 'count').textContent).toBe('2');
            expect(el.shadowRoot.querySelector('[data-option="latestOnly"]')).toBeNull();
            expect(q(el, 'no-records')).toBeNull();
        });

        it('names the zip after the preset label', async () => {
            const el = await mount({ presetRows: [row('9', 'Document', 2048)], presetLabel: 'Documents' });
            const frame = el.shadowRoot.querySelector('iframe');
            const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
            fromEngine(el, { type: 'ready' });
            await flush();
            q(el, 'download').click();
            await flush();
            expect(post.mock.calls[0][0]).toMatchObject({ type: 'start', objectLabel: 'Documents' });
        });
    });

    describe('job history', () => {
        async function finish(el, done) {
            const frame = el.shadowRoot.querySelector('iframe');
            const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
            fromEngine(el, { type: 'ready' });
            await flush();
            q(el, 'download').click();
            await flush();
            fromEngine(el, { type: 'done', jobId: post.mock.calls[0][0].jobId, ok: 3, failed: 0, oversized: 0, cancelled: false, ...done });
            await flush();
        }

        it('logs a finished run with its counts and the request for a re-run', async () => {
            const el = await mount({ recordIds: ['001A'], objectApiName: 'Account', request: { mode: 'search', objectApiName: 'Account', recordIds: ['001A'] } });
            await finish(el, {});
            expect(logJob).toHaveBeenCalledTimes(1);
            const job = logJob.mock.calls[0][0].job;
            expect(job).toMatchObject({ status: 'Done', sourceType: 'search', objectApiName: 'Account', destination: 'Browser', recordCount: 1, fileCount: 3, totalBytes: 1573888 });
            expect(JSON.parse(job.request)).toMatchObject({ mode: 'search', recordIds: ['001A'], options: { layout: 'PerRecord' } });
        });

        it('marks a run with failures as partial and a cancelled run as cancelled', async () => {
            const el = await mount({ recordIds: ['001A'] });
            await finish(el, { ok: 2, failed: 1 });
            expect(logJob.mock.calls[0][0].job).toMatchObject({ status: 'Partial', fileCount: 2, sourceType: 'records' });
            const el2 = await mount({ recordIds: ['001A'] });
            await finish(el2, { cancelled: true });
            expect(logJob.mock.calls[1][0].job.status).toBe('Cancelled');
        });

        it('still shows the result when logging fails', async () => {
            logJob.mockRejectedValue(new Error('no access'));
            const el = await mount({ recordIds: ['001A'] });
            await finish(el, {});
            expect(q(el, 'done')).not.toBeNull();
            expect(q(el, 'error')).toBeNull();
        });
    });

    describe('save to a folder', () => {
        let opened;
        let openSpy;

        beforeEach(() => {
            window.showDirectoryPicker = () => {};
            // A real window object stands in for the engine window the builder opens.
            const frame = document.createElement('iframe');
            document.body.appendChild(frame);
            opened = frame.contentWindow;
            openSpy = jest.spyOn(window, 'open').mockReturnValue(opened);
        });

        afterEach(() => {
            delete window.showDirectoryPicker;
            openSpy.mockRestore();
        });

        function fromFolderWindow(data) {
            const nonce = new URL(openSpy.mock.calls[0][0], 'https://x.example').searchParams.get('fc');
            window.dispatchEvent(
                new MessageEvent('message', { data: { fc: 1, nonce, ...data }, origin: 'https://org--c.vf.force.com', source: opened })
            );
        }

        it('is not offered when the browser has no folder picker', async () => {
            delete window.showDirectoryPicker;
            const el = await mount({ recordIds: ['001A'] });
            expect(q(el, 'folder')).toBeNull();
        });

        it('is offered when the browser has a folder picker', async () => {
            const el = await mount({ recordIds: ['001A'] });
            expect(q(el, 'folder')).not.toBeNull();
        });

        it('opens the engine in its own window and sends it the job once it is ready', async () => {
            const el = await mount({ recordIds: ['001A'], objectApiName: 'Account' });
            const post = jest.spyOn(opened, 'postMessage').mockImplementation(() => {});
            q(el, 'folder').click();
            await flush();
            const url = openSpy.mock.calls[0][0];
            expect(url).toContain('/apex/FcEngine?fc=');
            expect(url).toContain('mode=folder');
            expect(url).not.toContain(nonceOf(el));
            expect(post).not.toHaveBeenCalled();
            expect(q(el, 'progress')).not.toBeNull();

            fromFolderWindow({ type: 'ready' });
            await flush();
            const sent = post.mock.calls.map((c) => c[0]);
            expect(post.mock.calls[0][1]).toBe('https://org--c.vf.force.com');
            expect(sent[0]).toMatchObject({ type: 'start', options: { output: 'folder', layout: 'PerRecord' } });
            expect(sent[1]).toMatchObject({ type: 'rows', last: true });
            expect(sent[1].rows).toHaveLength(3);

            fromFolderWindow({ type: 'done', jobId: sent[0].jobId, ok: 3, failed: 0, oversized: 0, cancelled: false, folder: true });
            await flush();
            expect(q(el, 'done-text').textContent).toBe('c.Fc_Done_Folder');
            expect(logJob.mock.calls[0][0].job.destination).toBe('Folder');
        });

        it('sends the job only once even if the window reports ready again', async () => {
            const el = await mount({ recordIds: ['001A'] });
            const post = jest.spyOn(opened, 'postMessage').mockImplementation(() => {});
            q(el, 'folder').click();
            await flush();
            fromFolderWindow({ type: 'ready' });
            fromFolderWindow({ type: 'ready' });
            await flush();
            expect(post.mock.calls.filter((c) => c[0].type === 'start')).toHaveLength(1);
        });

        it('ends the run as cancelled when the folder window is closed', async () => {
            jest.useFakeTimers();
            try {
                const el = await mount({ recordIds: ['001A'] });
                q(el, 'folder').click();
                await flush();
                Object.defineProperty(opened, 'closed', { value: true, configurable: true });
                jest.advanceTimersByTime(2000);
                await flush();
                expect(q(el, 'done-text').textContent).toBe('c.Fc_Cancelled');
            } finally {
                jest.useRealTimers();
            }
        });

        it('gives up when the folder window never starts', async () => {
            jest.useFakeTimers();
            try {
                const el = await mount({ recordIds: ['001A'] });
                fromEngine(el, { type: 'ready' });
                q(el, 'folder').click();
                await flush();
                jest.advanceTimersByTime(40000);
                await flush();
                expect(q(el, 'error').textContent).toBe('c.Fc_Engine_Error');
            } finally {
                jest.useRealTimers();
            }
        });

        it('ends the run at once when Cancel is clicked, and closes the window', async () => {
            const el = await mount({ recordIds: ['001A'] });
            const close = jest.spyOn(opened, 'close').mockImplementation(() => {});
            q(el, 'folder').click();
            await flush();
            q(el, 'cancel').click();
            await flush();
            expect(close).toHaveBeenCalled();
            expect(q(el, 'done-text').textContent).toBe('c.Fc_Cancelled');
        });

        it('explains when the browser blocks the window', async () => {
            openSpy.mockReturnValue(null);
            const el = await mount({ recordIds: ['001A'] });
            q(el, 'folder').click();
            await flush();
            expect(q(el, 'error').textContent).toBe('c.Fc_Popup_Blocked');
        });
    });

    it('starts from the options of an earlier run when it is given them', async () => {
        const el = await mount({ recordIds: ['001A'], initialOptions: { layout: 'Flat', includeAttachments: false, pattern: '{Title}.{ext}', maxZipBytes: 1 } });
        expect(q(el, 'count').textContent).toBe('2');
        expect(el.shadowRoot.querySelector('[data-option="layout"]').value).toBe('Flat');
        expect(el.shadowRoot.querySelector('[data-option="pattern"]').value).toBe('{Title}.{ext}');
        expect(q(el, 'parts-notice')).toBeNull();
    });

    it('logs a run that stopped with a fatal error as failed', async () => {
        const el = await mount({ recordIds: ['001A'] });
        const frame = el.shadowRoot.querySelector('iframe');
        const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
        fromEngine(el, { type: 'ready' });
        await flush();
        q(el, 'download').click();
        await flush();
        fromEngine(el, { type: 'fatal', jobId: post.mock.calls[0][0].jobId, code: 'AUTH', message: 'HTTP 401' });
        await flush();
        expect(logJob.mock.calls[0][0].job).toMatchObject({ status: 'Failed', error: 'HTTP 401', fileCount: 0 });
    });

    it('does not log a fatal error that is not part of a run', async () => {
        const el = await mount({ recordIds: ['001A'] });
        fromEngine(el, { type: 'ready' });
        fromEngine(el, { type: 'fatal', jobId: null, code: 'AUTH', message: 'HTTP 401' });
        await flush();
        expect(logJob).not.toHaveBeenCalled();
    });

    it('marks the saved request when it had to leave record ids out', async () => {
        const ids = Array.from({ length: 2100 }, (_, i) => 'id' + i);
        const el = await mount({ recordIds: ids });
        const frame = el.shadowRoot.querySelector('iframe');
        const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
        fromEngine(el, { type: 'ready' });
        await flush();
        q(el, 'download').click();
        await flush();
        fromEngine(el, { type: 'done', jobId: post.mock.calls[0][0].jobId, ok: 3, failed: 0, oversized: 0, cancelled: false });
        await flush();
        const request = JSON.parse(logJob.mock.calls[0][0].job.request);
        expect(request.recordIds).toHaveLength(2000);
        expect(request.recordIdsTruncated).toBe(true);
    });
});
