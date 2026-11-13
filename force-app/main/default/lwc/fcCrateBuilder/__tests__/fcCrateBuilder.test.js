import { createElement } from 'lwc';
import FcCrateBuilder from 'c/fcCrateBuilder';
import getFiles from '@salesforce/apex/FcFileQueryService.getFiles';
import getSettings from '@salesforce/apex/FcSettingsService.getSettings';

jest.mock('@salesforce/apex/FcFileQueryService.getFiles', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcSettingsService.getSettings', () => ({ default: jest.fn() }), { virtual: true });

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

function fromEngine(el, data) {
    const frame = el.shadowRoot.querySelector('iframe');
    window.dispatchEvent(
        new MessageEvent('message', { data: { fc: 1, ...data }, origin: 'https://org--c.vf.force.com', source: frame.contentWindow })
    );
}

describe('c-fc-crate-builder', () => {
    beforeEach(() => {
        getSettings.mockResolvedValue(SETTINGS);
        getFiles.mockResolvedValue([row('1', 'File', 1048576), row('2', 'File', 524288), row('3', 'Attachment', 1024)]);
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
        expect(post.mock.calls[0][0]).toEqual({ fc: 1, type: 'listview', object: 'Account', listViewId: '00B1' });
        fromEngine(el, { type: 'ids', ids: ['001A', '001B'] });
        await flush();
        expect(getFiles).toHaveBeenCalledWith({ recordIds: ['001A', '001B'], latestOnly: true });
        expect(q(el, 'count').textContent).toBe('3');
    });
});
