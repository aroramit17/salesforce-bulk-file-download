import { createElement } from 'lwc';
import FcSetup from 'c/fcSetup';
import getStatus from '@salesforce/apex/FcSetupService.getStatus';

jest.mock('@salesforce/apex/FcSetupService.getStatus', () => ({ default: jest.fn() }), { virtual: true });

const flush = async () => {
    for (let i = 0; i < 6; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

const STATUS = {
    settings: { maxFilesPerZip: 500, maxZipMb: 1500, includeAttachments: true, includeNotes: true, latestVersionOnly: true, namePattern: '{RecordName}_{Title}.{ext}', folderLayout: 'PerRecord' },
    fileStorage: { usedMb: 12, maxMb: 20 },
    dataStorage: { usedMb: 1, maxMb: 5 },
    canRunSoql: true,
    canReadEventLogs: false,
    apiVersion: '66.0'
};

async function mount() {
    const el = createElement('c-fc-setup', { is: FcSetup });
    document.body.appendChild(el);
    await flush();
    return el;
}

const q = (el, id) => el.shadowRoot.querySelector('[data-id="' + id + '"]');

function fromEngine(el, data) {
    const frame = el.shadowRoot.querySelector('iframe');
    const nonce = new URL(frame.src, 'https://x.example').searchParams.get('fc');
    window.dispatchEvent(new MessageEvent('message', { data: { fc: 1, nonce, ...data }, origin: 'https://org--c.vf.force.com', source: frame.contentWindow }));
}

describe('c-fc-setup', () => {
    beforeEach(() => {
        getStatus.mockResolvedValue(STATUS);
    });
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('shows the settings and storage use', async () => {
        const el = await mount();
        expect(q(el, 'setting-maxZipMb').textContent).toBe('1500');
        expect(q(el, 'setting-namePattern').textContent).toBe('{RecordName}_{Title}.{ext}');
        expect(q(el, 'file-storage').textContent).toBe('12 MB / 20 MB');
        expect(q(el, 'soql').textContent).toBe('c.Fc_Yes');
        expect(q(el, 'event-logs').textContent).toBe('c.Fc_No');
    });

    it('checks API access through the engine', async () => {
        const el = await mount();
        const frame = el.shadowRoot.querySelector('iframe');
        const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
        expect(q(el, 'api').textContent).toBe('c.Fc_Checking');
        fromEngine(el, { type: 'ready' });
        await flush();
        expect(post.mock.calls[0][0]).toMatchObject({ fc: 1, type: 'ping' });
        fromEngine(el, { type: 'pong', requestId: post.mock.calls[0][0].requestId, ok: true, apiRemaining: 14000, apiMax: 15000 });
        await flush();
        expect(q(el, 'api').textContent).toBe('c.Fc_Api_Ok');
    });

    it('reports when the API check fails', async () => {
        const el = await mount();
        const frame = el.shadowRoot.querySelector('iframe');
        const post = jest.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => {});
        fromEngine(el, { type: 'ready' });
        await flush();
        fromEngine(el, { type: 'pong', requestId: post.mock.calls[0][0].requestId, ok: false, error: 'HTTP 403' });
        await flush();
        expect(q(el, 'api').textContent).toBe('c.Fc_Api_Failed');
    });

    it('shows an error when the status cannot be loaded', async () => {
        getStatus.mockRejectedValue({ body: { message: 'boom' } });
        const el = await mount();
        expect(q(el, 'error').textContent).toContain('boom');
    });
});
