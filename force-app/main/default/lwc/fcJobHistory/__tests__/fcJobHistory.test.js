import { createElement } from 'lwc';
import FcJobHistory from 'c/fcJobHistory';
import getJobs from '@salesforce/apex/FcJobService.getJobs';

jest.mock('@salesforce/apex/FcJobService.getJobs', () => ({ default: jest.fn() }), { virtual: true });

const flush = async () => {
    for (let i = 0; i < 6; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

const JOB = {
    id: 'a00A', name: 'FC-000001', status: 'Done', sourceType: 'listviews', objectApiName: 'Account', destination: 'Browser',
    recordCount: 3, fileCount: 29, totalBytes: 1572864, request: '{"mode":"listviews","listViews":[]}',
    createdDate: '2026-11-13T22:00:00.000Z', createdByName: 'Ada Admin'
};

async function mount() {
    const el = createElement('c-fc-job-history', { is: FcJobHistory });
    document.body.appendChild(el);
    await flush();
    return el;
}

describe('c-fc-job-history', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('lists jobs with a readable size', async () => {
        getJobs.mockResolvedValue([JOB]);
        const el = await mount();
        const table = el.shadowRoot.querySelector('lightning-datatable');
        expect(table.data).toHaveLength(1);
        expect(table.data[0]).toMatchObject({ name: 'FC-000001', sizeText: '1.5 MB', fileCount: 29, createdByName: 'Ada Admin' });
    });

    it('shows readable words for the source, status and destination', async () => {
        getJobs.mockResolvedValue([JOB, { ...JOB, id: 'a00B', sourceType: 'something new', status: 'Odd', destination: 'Folder' }]);
        const el = await mount();
        const data = el.shadowRoot.querySelector('lightning-datatable').data;
        expect(data[0]).toMatchObject({ sourceLabel: 'c.Fc_Src_listviews', statusLabel: 'c.Fc_Status_Done', destinationLabel: 'c.Fc_Dest_Browser' });
        expect(data[1]).toMatchObject({ sourceLabel: 'something new', statusLabel: 'Odd', destinationLabel: 'c.Fc_Dest_Folder' });
    });

    it('hands the saved request to its host when Re-run is chosen', async () => {
        getJobs.mockResolvedValue([JOB]);
        const el = await mount();
        const handler = jest.fn();
        el.addEventListener('rerun', handler);
        el.shadowRoot.querySelector('lightning-datatable').dispatchEvent(
            new CustomEvent('rowaction', { detail: { action: { name: 'rerun' }, row: { id: 'a00A' } } })
        );
        expect(handler.mock.calls[0][0].detail.request).toEqual({ mode: 'listviews', listViews: [] });
    });

    it('does not offer a re-run for a job whose request cannot be read', async () => {
        getJobs.mockResolvedValue([{ ...JOB, request: 'not json' }]);
        const el = await mount();
        const handler = jest.fn();
        el.addEventListener('rerun', handler);
        el.shadowRoot.querySelector('lightning-datatable').dispatchEvent(
            new CustomEvent('rowaction', { detail: { action: { name: 'rerun' }, row: { id: 'a00A' } } })
        );
        expect(handler).not.toHaveBeenCalled();
    });

    it('says so when there are no jobs yet', async () => {
        getJobs.mockResolvedValue([]);
        const el = await mount();
        expect(el.shadowRoot.querySelector('[data-id="empty"]')).not.toBeNull();
        expect(el.shadowRoot.querySelector('lightning-datatable')).toBeNull();
    });

    it('shows an error when the history cannot be loaded', async () => {
        getJobs.mockRejectedValue({ body: { message: 'no access' } });
        const el = await mount();
        expect(el.shadowRoot.querySelector('[data-id="error"]').textContent).toContain('no access');
    });
});
